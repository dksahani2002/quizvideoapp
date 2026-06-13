import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getMe, login, register } from '../services/authService.js';

export function createAuthRoutes(): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    const result = await register(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/login', async (req: Request, res: Response) => {
    const result = await login(req.body);
    res.status(result.status).json(result.body);
  });

  router.get('/me', authMiddleware, async (req: Request, res: Response) => {
    const result = await getMe(req.user!.id, req.user!.role);
    res.status(result.status).json(result.body);
  });

  return router;
}
