import { Router, type Request, type Response } from 'express';

import { cancelJob, getJob, retryJob } from '../services/jobsService.js';

export function createJobsRoutes(): Router {
  const router = Router();

  router.get('/:id', async (req: Request, res: Response) => {
    const result = await getJob(req.user!.id, req.params.id);
    res.status(result.status).json(result.body);
  });

  router.post('/:id/cancel', async (req: Request, res: Response) => {
    const result = await cancelJob(req.user!.id, req.params.id);
    res.status(result.status).json(result.body);
  });

  router.post('/:id/retry', async (req: Request, res: Response) => {
    const result = await retryJob(req.user!.id, req.params.id);
    res.status(result.status).json(result.body);
  });

  return router;
}

// Backward-compatible alias while normalizing route factory naming.
export const createJobRoutes = createJobsRoutes;
