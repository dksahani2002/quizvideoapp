import type { Request } from 'express';
import { loadEnvConfig } from '../config/envConfig.js';
import { loadSettings, saveSettings } from './settingsService.js';
import { getYouTubeAuthUrl, exchangeYouTubeCode } from './youtubeOAuthService.js';
import { connectInstagramGraph, publishReel } from './instagramGraphService.js';
import { PublishJob } from '../db/models/PublishJob.js';
import { Video } from '../db/models/Video.js';
import { getPresignedGetUrl, downloadObjectToFile } from './s3Storage.js';
import { uploadToYouTube } from './platforms/youtubeService.js';
import path from 'path';
import fs from 'fs';
import { ExportOnlyAdapter } from './publishers/exportAdapters.js';

export function requireEnv(val: string | undefined, name: string): string {
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

export function resolveYouTubeRedirectUri(req: Request, settingsRedirectUri?: string): string {
  const s = (settingsRedirectUri || '').trim();
  // If redirectUri is missing or still pointing at localhost, derive it from the deployed host.
  if (!s || /^https?:\/\/localhost[:/]/i.test(s) || /^https?:\/\/127\.0\.0\.1[:/]/i.test(s)) {
    return `${getBaseUrl(req)}/api/publish/youtube/callback`;
  }
  return s;
}

const YOUTUBE_OAUTH_STATE_MAX_AGE_MS = 30 * 60 * 1000;

/** UI origin to return to after OAuth (Vite dev server or same host as API). */
export function resolvePublishUiOrigin(req: Request): string {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (origin.startsWith('http://') || origin.startsWith('https://')) return origin;
  const cors = loadEnvConfig()
    .CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cors.length > 0) {
    try {
      return new URL(cors[0]).origin;
    } catch {
      /* fall through */
    }
  }
  return getBaseUrl(req);
}

function parseYouTubeOAuthState(raw: string): { userId: string; returnOrigin?: string } | null {
  if (!raw.trim()) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      userId?: unknown;
      t?: unknown;
      returnOrigin?: unknown;
    };
    const userId = typeof json.userId === 'string' ? json.userId.trim() : '';
    if (!/^[a-f0-9]{24}$/i.test(userId)) return null;
    const t = typeof json.t === 'number' ? json.t : 0;
    if (t && Date.now() - t > YOUTUBE_OAUTH_STATE_MAX_AGE_MS) return null;
    const ro = typeof json.returnOrigin === 'string' ? json.returnOrigin.trim() : '';
    const returnOrigin =
      ro.startsWith('http://') || ro.startsWith('https://') ? new URL(ro).origin : undefined;
    return { userId, returnOrigin };
  } catch {
    return null;
  }
}

export interface OAuthCallbackRedirect {
  returnOrigin?: string;
  params: Record<string, string>;
}

export async function processYouTubeOAuthCallback(req: Request): Promise<OAuthCallbackRedirect> {
  const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';
  const parsed = parseYouTubeOAuthState(stateRaw);
  const returnOrigin = parsed?.returnOrigin;

  const googleError = typeof req.query.error === 'string' ? req.query.error : '';
  if (googleError) {
    const desc =
      typeof req.query.error_description === 'string' ? req.query.error_description : googleError;
    return { params: { youtube: 'error', message: desc.slice(0, 200) }, returnOrigin };
  }

  if (!parsed) {
    return {
      params: { youtube: 'error', message: 'Invalid or expired OAuth state. Generate a new connect link.' },
      returnOrigin,
    };
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return { params: { youtube: 'error', message: 'Missing authorization code' }, returnOrigin };
  }

  try {
    const { userId } = parsed;
    const settings = await loadSettings(userId);
    const redirectUri = resolveYouTubeRedirectUri(req, settings.youtube.redirectUri);
    const { refreshToken } = await exchangeYouTubeCode({
      clientId: requireEnv(settings.youtube.clientId, 'YouTube clientId'),
      clientSecret: requireEnv(settings.youtube.clientSecret, 'YouTube clientSecret'),
      redirectUri,
      code,
    });
    await saveSettings(userId, {
      youtube: { ...settings.youtube, refreshToken, redirectUri },
    } as Partial<typeof settings>);
    return { params: { youtube: 'connected' }, returnOrigin };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { params: { youtube: 'error', message: msg.slice(0, 200) }, returnOrigin };
  }
}

export async function getYouTubeConnectUrl(userId: string, req: Request): Promise<string> {
  const settings = await loadSettings(userId);
  const returnOrigin = resolvePublishUiOrigin(req);
  const state = Buffer.from(
    JSON.stringify({ userId, t: Date.now(), returnOrigin })
  ).toString('base64url');
  const redirectUri = resolveYouTubeRedirectUri(req, settings.youtube.redirectUri);
  return getYouTubeAuthUrl({
    clientId: requireEnv(settings.youtube.clientId, 'YouTube clientId'),
    clientSecret: requireEnv(settings.youtube.clientSecret, 'YouTube clientSecret'),
    redirectUri,
    state,
  });
}

export function getInstagramConnectUrl(): string {
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
  return u.toString();
}

export async function handleInstagramCallback(
  userId: string,
  query: Request['query']
): Promise<void> {
  const env = loadEnvConfig();
  const code = typeof query.code === 'string' ? query.code : '';
  const preferredPageId = typeof query.pageId === 'string' ? query.pageId : undefined;
  if (!code) {
    throw new Error('Missing code');
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
}

export async function schedulePublishJob(
  userId: string,
  input: {
    videoId: string;
    platform: string;
    when: Date;
    title: unknown;
    description: unknown;
    caption: unknown;
  }
): Promise<string> {
  const job = await PublishJob.create({
    userId,
    videoId: input.videoId,
    platform: input.platform,
    scheduledAt: input.when,
    status: 'scheduled',
    attempts: 0,
    resultJson: JSON.stringify({
      title: input.title,
      description: input.description,
      caption: input.caption,
    }),
  });
  return job._id.toString();
}

export async function runDuePublishJobs(userId: string): Promise<any[]> {
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

        const captionText = String(meta.caption || '').trim() || '🎯 Quiz Challenge!\n\n#quiz #reels #shorts';
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

  return results;
}

export async function buildExportPlan(userId: string, platform: string, videoId: string) {
  const adapter = new ExportOnlyAdapter(platform as any);
  return adapter.buildExportPlan({ userId, videoId });
}
