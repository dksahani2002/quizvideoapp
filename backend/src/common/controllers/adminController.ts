import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getAuditEvents, listAdminUsers } from '../services/adminService.js';

export function createAdminRoutes(): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', async (_req: Request, res: Response) => {
    const users = await listAdminUsers();
    res.json({ success: true, data: users });
  });

  router.get('/audit', async (req: Request, res: Response) => {
    const data = await getAuditEvents(req.query as Record<string, unknown>);
    res.json({ success: true, data });
  });

  return router;
}
