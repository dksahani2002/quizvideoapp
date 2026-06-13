import { Router, Request, Response } from 'express';
import { getAnalyticsSummary, refreshYouTubeAnalytics } from '../../publish/services/analyticsService.js';

export function createAnalyticsRoutes(): Router {
  const router = Router();

  router.get('/summary', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const data = await getAnalyticsSummary(userId);
    res.json({ success: true, data });
  });

  router.post('/youtube/refresh', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await refreshYouTubeAnalytics(userId);
    if ('error' in result) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: { updated: result.updated } });
  });

  return router;
}
