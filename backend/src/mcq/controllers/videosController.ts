/**
 * Videos Controller
 * Maps HTTP inputs to videosService and shapes API responses.
 */

import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

import type { EnvConfig } from '../../common/config/envConfig.js';
import { authMiddleware } from '../../auth/index.js';
import { streamS3ObjectToHttpResponse } from '../../common/services/s3Storage.js';
import {
  deleteUserVideo,
  findUserVideoByFilename,
  findUserVideoById,
  generateVideosForUser,
  getPresignedUrlForPlayback,
  listUserVideos,
  localVideoExists,
  previewTopicForUser,
  resolveLocalVideoPath,
  resolveS3Playback,
  resolveVideoFilePath,
  type GenerateVideosInput,
  type PreviewTopicInput,
} from '../services/videosService.js';

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export async function listVideosController(userId: string): Promise<ApiResult> {
  try {
    const data = await listUserVideos(userId);
    return { status: 200, body: { success: true, data } };
  } catch (error) {
    return { status: 500, body: { success: false, error: String(error) } };
  }
}

export async function serveVideoFileController(
  userId: string,
  requestedUserId: string,
  filename: string,
  env: EnvConfig
): Promise<
  | { kind: 'forbidden' }
  | { kind: 'redirect'; url: string }
  | { kind: 'file'; filePath: string }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
> {
  if (userId !== requestedUserId) {
    return { kind: 'forbidden' };
  }

  const doc = await findUserVideoByFilename(userId, filename);
  if (doc) {
    try {
      const url = await getPresignedUrlForPlayback(doc, userId);
      if (url) return { kind: 'redirect', url };
    } catch (e) {
      console.error('S3 presign failed:', e);
      return { kind: 'error', message: 'Could not load video' };
    }
  }

  const filePath = resolveLocalVideoPath(env, userId, filename);
  if (!localVideoExists(filePath)) {
    return { kind: 'not_found' };
  }
  return { kind: 'file', filePath };
}

export async function getPlayUrlController(
  userId: string,
  videoId: string,
  env: EnvConfig
): Promise<ApiResult> {
  try {
    const video = await findUserVideoById(videoId, userId);
    if (!video) {
      return { status: 404, body: { success: false, error: 'Video not found' } };
    }

    const presigned = await getPresignedUrlForPlayback(video, userId);
    if (presigned) {
      return { status: 200, body: { success: true, url: presigned } };
    }

    const playToken = jwt.sign({ videoId: video._id.toString(), userId }, env.JWT_SECRET, {
      expiresIn: '10m',
    });
    return {
      status: 200,
      body: {
        success: true,
        url: `/api/videos/${video._id.toString()}/stream?token=${encodeURIComponent(playToken)}`,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { success: false, error: msg } };
  }
}

export async function downloadVideoController(
  userId: string,
  videoId: string
): Promise<
  | { kind: 'not_found' }
  | { kind: 'redirect'; url: string }
  | { kind: 'download'; filePath: string; filename: string }
  | { kind: 'missing_file' }
  | { kind: 'error'; message: string }
> {
  try {
    const video = await findUserVideoById(videoId, userId);
    if (!video) {
      return { kind: 'not_found' };
    }

    const presigned = await getPresignedUrlForPlayback(video, userId);
    if (presigned) {
      return { kind: 'redirect', url: presigned };
    }

    const filePath = resolveVideoFilePath(video);
    if (!localVideoExists(filePath)) {
      return { kind: 'missing_file' };
    }
    return { kind: 'download', filePath, filename: video.filename };
  } catch (error) {
    return { kind: 'error', message: String(error) };
  }
}

export async function deleteVideoController(userId: string, videoId: string): Promise<ApiResult> {
  try {
    const deleted = await deleteUserVideo(userId, videoId);
    if (!deleted) {
      return { status: 404, body: { success: false, error: 'Video not found' } };
    }
    return { status: 200, body: { success: true } };
  } catch (error) {
    return { status: 500, body: { success: false, error: String(error) } };
  }
}

export async function previewTopicController(
  userId: string,
  input: PreviewTopicInput
): Promise<ApiResult> {
  try {
    const data = await previewTopicForUser(userId, input);
    return { status: 200, body: { success: true, data } };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes('required') || msg.includes('OpenAI') ? 400 : 500;
    return { status, body: { success: false, error: msg } };
  }
}

export async function generateVideosController(
  userId: string,
  env: EnvConfig,
  body: GenerateVideosInput
): Promise<ApiResult> {
  try {
    const data = await generateVideosForUser(userId, env, body);
    return { status: 200, body: { success: true, data } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Video generation failed';
    console.error('Video generation failed:', msg);
    const status =
      msg.includes('required') || msg.includes('OpenAI') || msg.includes('No valid quizzes') ? 400 : 500;
    return { status, body: { success: false, error: msg } };
  }
}

export async function streamVideoController(
  req: Request,
  res: Response,
  env: EnvConfig
): Promise<void> {
  let decoded: { videoId: string; userId: string };
  try {
    const token = (typeof req.query.token === 'string' ? req.query.token : '').trim();
    if (!token) {
      res.status(401).json({ success: false, error: 'Missing token' });
      return;
    }
    decoded = jwt.verify(token, env.JWT_SECRET) as { videoId: string; userId: string };
    if (!decoded?.videoId || decoded.videoId !== req.params.id) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
    return;
  }

  try {
    const video = await findUserVideoById(decoded.videoId, decoded.userId);
    if (!video) {
      res.status(404).json({ success: false, error: 'Video not found' });
      return;
    }

    const s3 = resolveS3Playback(video, decoded.userId);
    if (s3) {
      await streamS3ObjectToHttpResponse(s3.bucket, s3.key, req, res);
      return;
    }

    const filePath = path.resolve(video.filePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'Video file missing' });
      return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (!range) {
      res.status(200);
      res.setHeader('Content-Length', String(fileSize));
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.status(416).end();
      return;
    }
    const start = m[1] ? Math.min(parseInt(m[1], 10), fileSize - 1) : 0;
    const end = m[2]
      ? Math.min(parseInt(m[2], 10), fileSize - 1)
      : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', String(chunkSize));
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: msg });
    }
  }
}

export function createVideosRoutes(env: EnvConfig): Router {
  const router = Router();

  // Stream endpoint for local/dev playback (no Authorization header required).
  // This is used when the video is on local disk (no S3), because <video> cannot send Bearer tokens.
  router.get('/:id/stream', (req: Request, res: Response) => {
    void streamVideoController(req, res, env);
  });

  router.use(authMiddleware);

  router.get('/', async (req: Request, res: Response) => {
    const result = await listVideosController(req.user!.id);
    res.status(result.status).json(result.body);
  });

  router.get('/files/:userId/:filename', async (req: Request, res: Response) => {
    const result = await serveVideoFileController(req.user!.id, req.params.userId, req.params.filename, env);

    switch (result.kind) {
      case 'forbidden':
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      case 'redirect':
        res.redirect(302, result.url);
        return;
      case 'file':
        res.sendFile(result.filePath);
        return;
      case 'error':
        res.status(500).json({ success: false, error: result.message });
        return;
      case 'not_found':
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
    }
  });

  // Get a direct playback URL for <video src="...">.
  // Needed because the HTML media element can't send Authorization headers.
  router.get('/:id/play', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await getPlayUrlController(req.user!.id, req.params.id, env);
    res.status(result.status).json(result.body);
  });

  router.get('/:id/download', async (req: Request, res: Response) => {
    const result = await downloadVideoController(req.user!.id, req.params.id);

    switch (result.kind) {
      case 'not_found':
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      case 'redirect':
        res.redirect(302, result.url);
        return;
      case 'download':
        res.download(result.filePath, result.filename);
        return;
      case 'missing_file':
        res.status(404).json({ success: false, error: 'Video file missing' });
        return;
      case 'error':
        res.status(500).json({ success: false, error: result.message });
        return;
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const result = await deleteVideoController(req.user!.id, req.params.id);
    res.status(result.status).json(result.body);
  });

  /** Preview topic translation / enhancement (same OpenAI step as generate, without creating a job). */
  router.post('/preview-topic', async (req: Request, res: Response) => {
    const result = await previewTopicController(req.user!.id, req.body as PreviewTopicInput);
    res.status(result.status).json(result.body);
  });

  router.post('/generate', async (req: Request, res: Response) => {
    const result = await generateVideosController(req.user!.id, env, req.body as GenerateVideosInput);
    if (!res.headersSent) {
      res.status(result.status).json(result.body);
    }
  });

  return router;
}

// Backward-compatible alias while normalizing route factory naming.
export const createVideoRoutes = createVideosRoutes;
