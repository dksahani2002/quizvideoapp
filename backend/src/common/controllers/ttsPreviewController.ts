import { Router, Request, Response } from 'express';
import { generateTtsPreview } from '../services/ttsPreviewService.js';

/**
 * POST /api/tts/preview
 * Returns a short MP3 using the same TTS stack as video rendering.
 */
export function createTtsPreviewRoutes(): Router {
  const router = Router();

  router.post('/preview', async (req: Request, res: Response) => {
    const result = await generateTtsPreview(req.user!.id, req.body);
    if (result.kind === 'bad_request') {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    if (result.kind === 'error') {
      res.status(500).json({ success: false, error: result.error });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(result.buffer);
  });

  return router;
}
