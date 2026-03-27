import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AuditEvent } from '../db/models/AuditEvent.js';
import { User } from '../db/models/User.js';

export function createAdminRoutes(): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', async (_req: Request, res: Response) => {
    const users = await User.find({}).select('_id name email role createdAt').sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      success: true,
      data: users.map((u: any) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role || 'user',
        createdAt: new Date(u.createdAt).toISOString(),
      })),
    });
  });

  router.get('/audit', async (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const cursor = String(req.query.cursor || '').trim();
    const userId = String(req.query.userId || '').trim();
    const action = String(req.query.action || '').trim();
    const statusMin = req.query.statusMin ? parseInt(String(req.query.statusMin), 10) : undefined;
    const statusMax = req.query.statusMax ? parseInt(String(req.query.statusMax), 10) : undefined;

    const q: any = {};
    if (userId) q.userId = userId;
    if (action) q.action = action;
    if (typeof statusMin === 'number' && !Number.isNaN(statusMin)) q.statusCode = { ...(q.statusCode || {}), $gte: statusMin };
    if (typeof statusMax === 'number' && !Number.isNaN(statusMax)) q.statusCode = { ...(q.statusCode || {}), $lte: statusMax };
    if (cursor) q._id = { $lt: cursor };

    const rows = await AuditEvent.find(q).sort({ _id: -1 }).limit(limit).lean();
    const nextCursor = rows.length ? rows[rows.length - 1]._id.toString() : null;

    res.json({
      success: true,
      data: {
        items: rows.map((e: any) => ({
          id: e._id.toString(),
          userId: e.userId ? e.userId.toString() : '',
          action: e.action,
          method: e.method,
          path: e.path,
          statusCode: e.statusCode,
          durationMs: e.durationMs,
          ip: e.ip,
          userAgent: e.userAgent,
          error: e.error || '',
          createdAt: new Date(e.createdAt).toISOString(),
          meta: e.meta || null,
        })),
        nextCursor,
      },
    });
  });

  return router;
}

