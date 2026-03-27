import { Router, Request, Response } from 'express';
import { loadEnvConfig } from '../config/envConfig.js';
import { loadSettings, saveSettings } from '../services/settingsService.js';
import { getYouTubeAuthUrl, exchangeYouTubeCode } from '../services/youtubeOAuthService.js';
import { connectInstagramGraph, publishReel } from '../services/instagramGraphService.js';
import { PublishJob } from '../db/models/PublishJob.js';
import { Video } from '../db/models/Video.js';
import { getPresignedGetUrl } from '../services/s3Storage.js';
import { downloadObjectToFile } from '../services/s3Storage.js';
import { uploadToYouTube } from '../services/platforms/youtubeService.js';
import path from 'path';
import fs from 'fs';
import { ExportOnlyAdapter } from '../services/publishers/exportAdapters.js';

function requireEnv(val: string | undefined, name: string): string {
  const v = (val || '').trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function getBaseUrl(req: Request): string {
  // express is configured with `trust proxy`, so req.protocol honors x-forwarded-proto.
  const proto = (req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function resolveYouTubeRedirectUri(req: Request, settingsRedirectUri?: string): string {
  const s = (settingsRedirectUri || '').trim();
  // If redirectUri is missing or still pointing at localhost, derive it from the deployed host.
  if (!s || /^https?:\/\/localhost[:/]/i.test(s) || /^https?:\/\/127\.0\.0\.1[:/]/i.test(s)) {
    return `${getBaseUrl(req)}/api/publish/youtube/callback`;
  }
  return s;
}

export function createPublishRoutes(): Router {
  const router = Router();

  router.get('/youtube/connect-url', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const settings = await loadSettings(userId);
      const state = Buffer.from(JSON.stringify({ userId, t: Date.now() })).toString('base64url');
      const redirectUri = resolveYouTubeRedirectUri(req, settings.youtube.redirectUri);
      const url = getYouTubeAuthUrl({
        clientId: requireEnv(settings.youtube.clientId, 'YouTube clientId'),
        clientSecret: requireEnv(settings.youtube.clientSecret, 'YouTube clientSecret'),
        redirectUri,
        state,
      });
      res.json({ success: true, data: { url } });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'YouTube is not configured' });
    }
  });

  router.get('/youtube/callback', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) {
        res.status(400).json({ success: false, error: 'Missing code' });
        return;
      }
      const settings = await loadSettings(userId);
      const redirectUri = resolveYouTubeRedirectUri(req, settings.youtube.redirectUri);
      const { refreshToken } = await exchangeYouTubeCode({
        clientId: requireEnv(settings.youtube.clientId, 'YouTube clientId'),
        clientSecret: requireEnv(settings.youtube.clientSecret, 'YouTube clientSecret'),
        redirectUri,
        code,
      });
      await saveSettings(userId, { youtube: { ...settings.youtube, refreshToken } } as any);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'YouTube callback failed' });
    }
  });

  router.get('/instagram/connect-url', async (_req: Request, res: Response) => {
    try {
      const env = loadEnvConfig();
      const appId = requireEnv(env.META_APP_ID, 'META_APP_ID');
      const redirectUri = requireEnv(env.META_REDIRECT_URI, 'META_REDIRECT_URI');
      const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
      u.searchParams.set('client_id', appId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', [
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
      ].join(','));
      res.json({ success: true, data: { url: u.toString() } });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'Meta app not configured' });
    }
  });

  router.get('/instagram/callback', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const env = loadEnvConfig();
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const preferredPageId = typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
      if (!code) {
        res.status(400).json({ success: false, error: 'Missing code' });
        return;
      }
      const result = await connectInstagramGraph({
        appId: requireEnv(env.META_APP_ID, 'META_APP_ID'),
        appSecret: requireEnv(env.META_APP_SECRET, 'META_APP_SECRET'),
        redirectUri: requireEnv(env.META_REDIRECT_URI, 'META_REDIRECT_URI'),
        code,
        preferredPageId,
      });
      const settings = await loadSettings(userId);
      await saveSettings(userId, { instagramGraph: { ...settings.instagramGraph, ...result } } as any);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'Instagram callback failed' });
    }
  });

  router.post('/schedule', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { videoId, platform, scheduledAt, title, description, caption } = req.body || {};
    if (!videoId || !platform) {
      res.status(400).json({ success: false, error: 'videoId and platform required' });
      return;
    }
    const when = scheduledAt ? new Date(String(scheduledAt)) : new Date();
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid scheduledAt' });
      return;
    }
    const job = await PublishJob.create({
      userId,
      videoId,
      platform,
      scheduledAt: when,
      status: 'scheduled',
      attempts: 0,
      resultJson: JSON.stringify({ title, description, caption }),
    });
    res.json({ success: true, data: { id: job._id.toString() } });
  });

  router.post('/run-due', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const now = new Date();
    const due = await PublishJob.find({ userId, status: 'scheduled', scheduledAt: { $lte: now } }).limit(10);
    const results: any[] = [];

    for (const job of due) {
      job.status = 'running';
      job.attempts = (job.attempts || 0) + 1;
      job.lastError = '';
      await job.save();

      try {
        const video = await Video.findOne({ _id: job.videoId, userId }).lean();
        if (!video) throw new Error('Video not found');

        const meta = job.resultJson ? JSON.parse(job.resultJson) : {};

        if (job.platform === 'instagram') {
          const settings = await loadSettings(userId);
          if (!settings.instagramGraph?.accessToken || !settings.instagramGraph?.igUserId) {
            throw new Error('Instagram Graph not connected. Connect in Publishing first.');
          }
          let videoUrl: string;
          if (video.s3Bucket && video.s3Key) {
            videoUrl = await getPresignedGetUrl(video.s3Bucket, video.s3Key);
          } else {
            const localPath = path.resolve(video.filePath);
            if (!fs.existsSync(localPath)) throw new Error('Local video file missing');
            throw new Error('Instagram publishing requires S3-backed videos (publicly fetchable URL).');
          }

          const captionText = String(meta.caption || '').trim() || `🎯 Quiz Challenge!\n\n#quiz #reels #shorts`;
          const pub = await publishReel({
            igUserId: settings.instagramGraph.igUserId,
            accessToken: settings.instagramGraph.accessToken,
            videoUrl,
            caption: captionText,
          });
          job.status = 'published';
          job.resultJson = JSON.stringify({ ...meta, ...pub });
          await job.save();
          results.push({ id: job._id.toString(), platform: job.platform, ok: true });
        }

        if (job.platform === 'youtube') {
          const settings = await loadSettings(userId);
          const yt = settings.youtube;
          if (!yt.clientId || !yt.clientSecret || !yt.redirectUri || !yt.refreshToken) {
            throw new Error('YouTube not connected. Set credentials and connect in Publishing first.');
          }
          // S3-first: if the video is in S3, download to a temp file for upload.
          let localPath = path.resolve(video.filePath);
          if (video.s3Bucket && video.s3Key) {
            const tmpDir = path.join(process.env.TEMP_DIR || '/tmp', 'publish', userId);
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            localPath = path.join(tmpDir, video.filename || 'video.mp4');
            await downloadObjectToFile(video.s3Bucket, video.s3Key, localPath);
          }
          if (!fs.existsSync(localPath)) throw new Error('Video file missing for upload.');
          const titleText = String(meta.title || '').trim() || `${path.basename(video.filename, '.mp4')} 🎯`;
          const descText = String(meta.description || '').trim() || '';
          const r = await uploadToYouTube(localPath, { title: titleText, description: descText, privacyStatus: 'public' }, yt as any);
          if (!r.success) throw new Error(r.error || 'YouTube upload failed');
          job.status = 'published';
          job.resultJson = JSON.stringify({ ...meta, ...r });
          await job.save();
          results.push({ id: job._id.toString(), platform: job.platform, ok: true, url: r.url });
        }
      } catch (e: any) {
        job.status = 'failed';
        job.lastError = e?.message || String(e);
        await job.save();
        results.push({ id: job._id.toString(), platform: job.platform, ok: false, error: job.lastError });
      }
    }

    res.json({ success: true, data: results });
  });

  router.get('/export-plan', async (req: Request, res: Response) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : '';
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : '';
    if (!platform || !videoId) {
      res.status(400).json({ success: false, error: 'platform and videoId required' });
      return;
    }
    if (!['tiktok', 'x', 'snapchat'].includes(platform)) {
      res.status(400).json({ success: false, error: 'Unsupported export platform' });
      return;
    }
    const adapter = new ExportOnlyAdapter(platform as any);
    const plan = await adapter.buildExportPlan({ userId: req.user!.id, videoId });
    res.json({ success: true, data: plan });
  });

  return router;
}

