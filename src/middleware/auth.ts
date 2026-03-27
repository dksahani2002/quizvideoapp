import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadEnvConfig } from '../config/envConfig.js';

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

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const env = loadEnvConfig();
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role || 'user' };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.user?.role || 'user';
  if (role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
  next();
}
