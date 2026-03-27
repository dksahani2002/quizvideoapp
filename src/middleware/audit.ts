import type { Request, Response, NextFunction } from 'express';
import { AuditEvent, AuditAction } from '../db/models/AuditEvent.js';

function mapAction(req: Request): AuditAction | null {
  const p = req.path;
  const m = req.method.toUpperCase();

  if (p === '/api/auth/register' && m === 'POST') return 'auth.register';
  if (p === '/api/auth/login' && m === 'POST') return 'auth.login';
  if (p === '/api/auth/me' && m === 'GET') return 'auth.me';

  if (p === '/api/settings' && m === 'GET') return 'settings.get';
  if (p === '/api/settings' && m === 'PUT') return 'settings.update';

  if (p === '/api/videos' && m === 'GET') return 'videos.list';
  if (p === '/api/videos/generate' && m === 'POST') return 'videos.generate';
  if (/^\/api\/videos\/[^/]+\/play$/.test(p) && m === 'GET') return 'videos.play';
  if (/^\/api\/videos\/[^/]+\/download$/.test(p) && m === 'GET') return 'videos.download';
  if (/^\/api\/videos\/[^/]+$/.test(p) && m === 'DELETE') return 'videos.delete';

  if (/^\/api\/jobs\/[^/]+$/.test(p) && m === 'GET') return 'jobs.get';
  if (/^\/api\/jobs\/[^/]+\/cancel$/.test(p) && m === 'POST') return 'jobs.cancel';
  if (/^\/api\/jobs\/[^/]+\/retry$/.test(p) && m === 'POST') return 'jobs.retry';

  if (p === '/api/publish/youtube/connect-url' && m === 'GET') return 'publish.youtube.connect_url';
  if (p === '/api/publish/youtube/callback' && m === 'GET') return 'publish.youtube.callback';
  if (p === '/api/publish/instagram/connect-url' && m === 'GET') return 'publish.instagram.connect_url';
  if (p === '/api/publish/instagram/callback' && m === 'GET') return 'publish.instagram.callback';
  if (p === '/api/publish/schedule' && m === 'POST') return 'publish.schedule';
  if (p === '/api/publish/run-due' && m === 'POST') return 'publish.run_due';

  if (p === '/api/analytics/summary' && m === 'GET') return 'analytics.summary';
  if (p === '/api/analytics/youtube/refresh' && m === 'POST') return 'analytics.youtube.refresh';

  if (p === '/api/admin/audit' && m === 'GET') return 'admin.audit.query';
  if (p === '/api/admin/users' && m === 'GET') return 'admin.users.list';

  return null;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const action = mapAction(req);
  const started = Date.now();
  res.on('finish', () => {
    if (!action) return;
    const durationMs = Date.now() - started;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = String(req.headers['user-agent'] || '');
    const userId = req.user?.id;
    const statusCode = res.statusCode;

    void AuditEvent.create({
      userId: userId ? userId : undefined,
      action,
      method: req.method,
      path: req.path,
      ip,
      userAgent,
      statusCode,
      durationMs,
      error: statusCode >= 400 ? (res.getHeader('x-error-message') ? String(res.getHeader('x-error-message')) : '') : '',
      meta: {
        query: req.query,
        // Avoid storing secrets: do not record request body.
      },
    }).catch(() => {});
  });
  next();
}

