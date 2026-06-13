import { Router, Request, Response } from 'express';
import type { EnvConfig } from '../config/envConfig.js';
import { resolveUploadedFilePath, uploadBackgroundFile } from '../services/uploadFilesService.js';

export function createUploadFilesRoutes(env: EnvConfig): Router {
  const router = Router();

  router.post('/background', async (req: Request, res: Response) => {
    const result = await uploadBackgroundFile(req.user!.id, req.body, env);
    if (result.kind === 'bad_request') {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    if (result.kind === 'error') {
      res.status(500).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, path: result.path, url: result.url });
  });

  router.get('/files/:userId/:filename', (req: Request, res: Response) => {
    const result = resolveUploadedFilePath(req.user!.id, req.params.userId, req.params.filename, env);
    if (result.kind === 'forbidden') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    if (result.kind === 'not_found') {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.sendFile(result.filePath);
  });

  return router;
}

// Backward-compatible alias for previous naming.
export const createUploadsFilesRoutes = createUploadFilesRoutes;
