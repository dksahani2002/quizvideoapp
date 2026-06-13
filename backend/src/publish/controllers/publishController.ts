import { Router, Request, Response } from 'express';
import {
  buildExportPlan,
  getInstagramConnectUrl,
  getYouTubeConnectUrl,
  processYouTubeOAuthCallback,
  handleInstagramCallback,
  runDuePublishJobs,
  schedulePublishJob,
  resolvePublishUiOrigin,
} from '../services/publishService.js';

function redirectToPublishingUi(
  req: Request,
  res: Response,
  params: Record<string, string>,
  returnOrigin?: string
): void {
  const origin = returnOrigin || resolvePublishUiOrigin(req);
  const u = new URL('/publishing', origin);
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  res.redirect(302, u.toString());
}

/**
 * Google OAuth redirect target — mounted without JWT auth; user is identified from signed `state`.
 * Browser redirects from Google cannot send Authorization headers.
 */
export async function handleYouTubeOAuthCallback(req: Request, res: Response): Promise<void> {
  const result = await processYouTubeOAuthCallback(req);
  redirectToPublishingUi(req, res, result.params, result.returnOrigin);
}

export function createPublishRoutes(): Router {
  const router = Router();

  router.get('/youtube/connect-url', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const url = await getYouTubeConnectUrl(userId, req);
      res.json({ success: true, data: { url } });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'YouTube is not configured' });
    }
  });

  router.get('/instagram/connect-url', async (_req: Request, res: Response) => {
    try {
      const url = getInstagramConnectUrl();
      res.json({ success: true, data: { url } });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'Meta app not configured' });
    }
  });

  router.get('/instagram/callback', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      await handleInstagramCallback(userId, req.query);
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
    const id = await schedulePublishJob(userId, { videoId, platform, when, title, description, caption });
    res.json({ success: true, data: { id } });
  });

  router.post('/run-due', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const data = await runDuePublishJobs(userId);
    res.json({ success: true, data });
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
    const plan = await buildExportPlan(req.user!.id, platform, videoId);
    res.json({ success: true, data: plan });
  });

  return router;
}
