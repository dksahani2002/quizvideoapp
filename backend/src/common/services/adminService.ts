import { AuditEvent } from '../db/models/AuditEvent.js';
import { User } from '../db/models/User.js';

export async function listAdminUsers() {
  const users = await User.find({}).select('_id name email role createdAt').sort({ createdAt: -1 }).limit(200).lean();
  return users.map((u: any) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role || 'user',
    createdAt: new Date(u.createdAt).toISOString(),
  }));
}

export async function getAuditEvents(query: Record<string, unknown>) {
  const limit = Math.min(200, Math.max(1, parseInt(String(query.limit || '50'), 10)));
  const cursor = String(query.cursor || '').trim();
  const userId = String(query.userId || '').trim();
  const action = String(query.action || '').trim();
  const statusMin = query.statusMin ? parseInt(String(query.statusMin), 10) : undefined;
  const statusMax = query.statusMax ? parseInt(String(query.statusMax), 10) : undefined;

  const q: any = {};
  if (userId) q.userId = userId;
  if (action) q.action = action;
  if (typeof statusMin === 'number' && !Number.isNaN(statusMin)) q.statusCode = { ...(q.statusCode || {}), $gte: statusMin };
  if (typeof statusMax === 'number' && !Number.isNaN(statusMax)) q.statusCode = { ...(q.statusCode || {}), $lte: statusMax };
  if (cursor) q._id = { $lt: cursor };

  const rows = await AuditEvent.find(q).sort({ _id: -1 }).limit(limit).lean();
  const nextCursor = rows.length ? rows[rows.length - 1]._id.toString() : null;

  return {
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
  };
}
