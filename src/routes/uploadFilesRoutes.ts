import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { EnvConfig } from '../config/envConfig.js';
import { Upload } from '../db/models/Upload.js';

export function createUploadFilesRoutes(env: EnvConfig): Router {
  const router = Router();

  router.post('/background', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const { image, filename } = req.body;
      if (!image || !filename) {
        res.status(400).json({ success: false, error: 'image and filename required' });
        return;
      }

      const userUploadDir = path.resolve(path.join(env.UPLOADS_DIR, userId));
      if (!fs.existsSync(userUploadDir)) fs.mkdirSync(userUploadDir, { recursive: true });

      const base64Data = String(image).replace(/^data:image\/\w+;base64,/, '');
      const outPath = path.join(userUploadDir, String(filename));
      fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));

      await Upload.create({ userId, filename: String(filename), filePath: outPath });

      res.json({ success: true, path: outPath, url: `/api/uploads/files/${userId}/${String(filename)}` });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/files/:userId/:filename', (req: Request, res: Response) => {
    const userId = req.user!.id;
    if (userId !== req.params.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const filePath = path.resolve(env.UPLOADS_DIR, userId, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.sendFile(filePath);
  });

  return router;
}

// Backward-compatible alias for previous naming.
export const createUploadsFilesRoutes = createUploadFilesRoutes;

