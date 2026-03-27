import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../db/models/User.js';
import { loadEnvConfig } from '../config/envConfig.js';
import { authMiddleware } from '../middleware/auth.js';

function signToken(user: { id: string; email: string; name: string; role: 'user' | 'admin' }): string {
  const env = loadEnvConfig();
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function createAuthRoutes(): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        res.status(400).json({ success: false, error: 'Name, email, and password are required' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        return;
      }

      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        res.status(409).json({ success: false, error: 'Email already registered' });
        return;
      }

      const hashed = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email: email.toLowerCase(), password: hashed });
      const token = signToken({ id: user._id.toString(), email: user.email, name: user.name, role: user.role || 'user' });

      res.status(201).json({
        success: true,
        data: { token, user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role || 'user' } },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, error: 'Email and password are required' });
        return;
      }

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid email or password' });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ success: false, error: 'Invalid email or password' });
        return;
      }

      const token = signToken({ id: user._id.toString(), email: user.email, name: user.name, role: user.role || 'user' });

      res.json({
        success: true,
        data: { token, user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role || 'user' } },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/me', authMiddleware, (req: Request, res: Response) => {
    res.json({ success: true, data: req.user });
  });

  return router;
}
