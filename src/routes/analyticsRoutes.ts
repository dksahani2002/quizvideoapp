import { Router, Request, Response } from 'express';
import { PublishJob } from '../db/models/PublishJob.js';
import { loadSettings } from '../services/settingsService.js';
import { google } from 'googleapis';

function makeYouTubeClient(creds: { clientId: string; clientSecret: string; redirectUri: string; refreshToken: string }) {
  const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri);
  oauth2.setCredentials({ refresh_token: creds.refreshToken });
  return google.youtube({ version: 'v3', auth: oauth2 });
}

export function createAnalyticsRoutes(): Router {
  const router = Router();

  router.get('/summary', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const total = await PublishJob.countDocuments({ userId });
    const published = await PublishJob.countDocuments({ userId, status: 'published' });
    const failed = await PublishJob.countDocuments({ userId, status: 'failed' });
    const all = await PublishJob.find({ userId }).select('platform status').lean();
    const byPlatform = all.reduce<Record<string, number>>((acc, j: any) => {
      const k = `${j.platform}:${j.status}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const recent = await PublishJob.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();

    res.json({
      success: true,
      data: {
        total,
        published,
        failed,
        byPlatform,
        recent: recent.map((j: any) => ({
          id: j._id.toString(),
          platform: j.platform,
          status: j.status,
          scheduledAt: new Date(j.scheduledAt).toISOString(),
          createdAt: new Date(j.createdAt).toISOString(),
          lastError: j.lastError || '',
          result: j.resultJson ? safeParse(j.resultJson) : null,
        })),
      },
    });
  });

  router.post('/youtube/refresh', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const settings = await loadSettings(userId);
    const yt = settings.youtube;
    if (!yt.clientId || !yt.clientSecret || !yt.redirectUri || !yt.refreshToken) {
      res.status(400).json({ success: false, error: 'YouTube not connected' });
      return;
    }

    const jobs = await PublishJob.find({ userId, platform: 'youtube', status: 'published' }).sort({ createdAt: -1 }).limit(20);
    const ids: string[] = [];
    for (const j of jobs) {
      const r = j.resultJson ? safeParse(j.resultJson) : null;
      const vid = typeof r?.videoId === 'string' ? r.videoId : undefined;
      if (vid) ids.push(vid);
    }
    if (ids.length === 0) {
      res.json({ success: true, data: { updated: 0 } });
      return;
    }

    const youtube = makeYouTubeClient(yt as any);
    const resp = await youtube.videos.list({ part: ['statistics', 'snippet'], id: ids });
    const items = resp.data.items || [];
    const statsById = new Map(items.map((it: any) => [it.id, { statistics: it.statistics, snippet: it.snippet }]));

    let updated = 0;
    for (const j of jobs) {
      const r = j.resultJson ? safeParse(j.resultJson) : null;
      const vid = typeof r?.videoId === 'string' ? r.videoId : undefined;
      if (!vid) continue;
      const s = statsById.get(vid);
      if (!s) continue;
      j.resultJson = JSON.stringify({ ...r, youtubeStats: s.statistics, youtubeSnippet: s.snippet });
      await j.save();
      updated++;
    }

    res.json({ success: true, data: { updated } });
  });

  return router;
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

