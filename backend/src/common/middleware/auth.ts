import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadEnvConfig } from '../config/envConfig.js';
import { User } from '../db/models/User.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function readBearerOrQueryToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  // <video src>, window.open(), and Range requests cannot send Authorization; allow GET ?token= (same JWT).
  if (req.method === 'GET') {
    const raw = req.query.token;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  }
  return undefined;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerOrQueryToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  try {
    const env = loadEnvConfig();
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role || 'user' };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/** Use DB role so promoting/demoting users takes effect without waiting for token expiry. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const id = req.user?.id;
  if (!id) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  User.findById(id)
    .select('role')
    .lean()
    .then((user) => {
      if (!user || user.role !== 'admin') {
        res.status(403).json({ success: false, error: 'Admin access required' });
        return;
      }
      next();
    })
    .catch((e) => res.status(500).json({ success: false, error: String(e) }));
}
