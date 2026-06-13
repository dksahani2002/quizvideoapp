/**
 * Story-video HTTP controller (thin layer).
 *
 * Mounted at `/api/story-video` from app.ts (auth + rate limit applied upstream).
 * This file only wires Express routes → storyVideoService; business logic lives in
 * `../services/storyVideoService.ts`.
 *
 * Flow overview:
 *   1. Upload assets (presign / user-media / multipart on /create)
 *   2. POST /create → StoryVideoJob in MongoDB → queueStoryVideoJob → pipeline/run.ts
 *   3. Poll GET /:jobId/status and GET /:jobId/result
 *   4. POST /:jobId/edit (optional render) → timeline re-export
 *   5. GET /:jobId/play, /files/…, /subtitles.srt for playback and editor
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { EnvConfig } from '../../common/config/envConfig.js';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import {
  type StoryApiResult,
  type StoryFileResult,
  createStoryVideoJobService,
  presignStoryUploadService,
  isS3UploadConfigured,
  uploadUserMediaService,
  resolveUserMediaFileService,
  listStoryJobsService,
  cancelStoryJobService,
  retryStoryJobService,
  getStoryJobStatusService,
  getStoryJobResultService,
  getStoryPlayUrlService,
  getStorySubtitlesFileService,
  editStoryJobService,
  getOriginalVideoFileService,
  getOutputVideoFileService,
} from '../services/storyVideoService.js';

/** Multer field map for POST /create (video + optional audio + optional bgm). */
type StoryUploadFieldMap = Partial<Record<'video' | 'audio' | 'bgm', Express.Multer.File[]>>;
type RequestWithUser = Request & { user: { id: string } };

/** Temp dir for multipart files on POST /create (dev / non-production multipart). */
function ensureUploadRoot(env: EnvConfig): string {
  const root = path.join(env.TEMP_DIR, 'story-uploads');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Disk storage for job-create multipart uploads (UUID filenames). */
function createUploadStorage(env: EnvConfig): multer.StorageEngine {
  const root = ensureUploadRoot(env);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, root),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  });
}

/** JWT user id set by authMiddleware in app.ts. */
function userIdFrom(req: Request): string {
  return (req as RequestWithUser).user.id;
}

/** Send JSON from a service result `{ status, body }`. */
function sendApi(res: Response, result: StoryApiResult): void {
  res.status(result.status).json(result.body);
}

/**
 * Send either JSON error or a file download.
 * Services return `kind: 'json'` for 4xx/404 or `kind: 'file'` with headers + path.
 */
function sendFileResult(res: Response, result: StoryFileResult): void {
  if (result.kind === 'json') {
    res.status(result.status).json(result.body);
    return;
  }
  for (const [header, value] of Object.entries(result.headers || {})) {
    res.setHeader(header, value);
  }
  res.sendFile(result.path);
}

/**
 * Build the story-video router.
 *
 * @param env — TEMP_DIR, NODE_ENV (production disallows direct multipart on /create)
 */
export function createStoryVideoRoutes(env: EnvConfig): Router {
  const router = Router();

  // --- Multer: up to 4 GiB per file ---
  const upload = multer({
    storage: createUploadStorage(env),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  });
  /** No-S3 dev path: files land in TEMP_DIR/story-user-media/{userId}/ for GET /user-media/… */
  const userMediaUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const uid = userIdFrom(req);
        const dir = path.join(env.TEMP_DIR, 'story-user-media', uid);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safe = /^\.\w{1,8}$/.test(ext) ? ext : '.bin';
        cb(null, `${randomUUID()}${safe}`);
      },
    }),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  });

  // -------------------------------------------------------------------------
  // Job creation
  // -------------------------------------------------------------------------

  /**
   * POST /create
   * Start a story-video pipeline job.
   * Inputs: multipart fields OR https/s3 URLs OR dev asset paths (see storyVideoService).
   * Returns jobId immediately; processing runs async via queueStoryVideoJob.
   */
  router.post(
    '/create',
    upload.fields([
      { name: 'video', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
      { name: 'bgm', maxCount: 1 },
    ]),
    async (req, res) => {
      const result = await createStoryVideoJobService({
        env,
        userId: userIdFrom(req),
        body: req.body as Record<string, unknown>,
        files: req.files as StoryUploadFieldMap | undefined,
        idempotencyKeyRaw: req.headers['idempotency-key'] ?? (req.body as Record<string, unknown>).idempotencyKey,
      });
      sendApi(res, result);
    }
  );

  // -------------------------------------------------------------------------
  // Asset upload (before /create)
  // -------------------------------------------------------------------------

  /**
   * POST /presign-upload
   * S3 path: returns presigned PUT + GET URLs; client PUTs file then passes getUrl to /create.
   */
  router.post('/presign-upload', async (req, res) => {
    const result = await presignStoryUploadService({
      userId: userIdFrom(req),
      body: req.body as Record<string, unknown>,
    });
    sendApi(res, result);
  });

  /**
   * POST /upload-user-media
   * Local-dev path when S3 is not configured. Returns /api/story-video/user-media/… URL for /create.
   */
  router.post(
    '/upload-user-media',
    (_req, res, next) => {
      if (isS3UploadConfigured()) {
        res.status(400).json({
          success: false,
          error: 'S3 is configured — use presign-upload and PUT to the presigned URL.',
        });
        return;
      }
      next();
    },
    userMediaUpload.single('file'),
    async (req, res) => {
      const result = await uploadUserMediaService({
        userId: userIdFrom(req),
        body: req.body as Record<string, unknown>,
        file: req.file,
      });
      sendApi(res, result);
    }
  );

  /** GET /user-media/:userId/:filename — serve locally uploaded editor assets (no-S3 dev). */
  router.get('/user-media/:userId/:filename', async (req, res) => {
    const result = await resolveUserMediaFileService({
      env,
      authUserId: userIdFrom(req),
      userId: req.params.userId,
      filename: req.params.filename,
    });
    sendFileResult(res, result);
  });

  // -------------------------------------------------------------------------
  // Job lifecycle (list, cancel, retry, poll)
  // -------------------------------------------------------------------------

  /** GET /jobs — library / dashboard list for the current user. */
  router.get('/jobs', async (req, res) => {
    sendApi(res, await listStoryJobsService({ userId: userIdFrom(req), limitRaw: req.query.limit }));
  });

  /** POST /:jobId/cancel — sets cancelRequested; pipeline checks between stages. */
  router.post('/:jobId/cancel', async (req, res) => {
    sendApi(res, await cancelStoryJobService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  /** POST /:jobId/retry — re-queue a failed or cancelled job. */
  router.post('/:jobId/retry', async (req, res) => {
    sendApi(res, await retryStoryJobService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  /** GET /:jobId/status — progress %, stage, error (for polling UI). */
  router.get('/:jobId/status', async (req, res) => {
    sendApi(res, await getStoryJobStatusService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  /** GET /:jobId/result — timeline, output URLs, scenes JSON when ready. */
  router.get('/:jobId/result', async (req, res) => {
    sendApi(res, await getStoryJobResultService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  // -------------------------------------------------------------------------
  // Playback & downloads
  // -------------------------------------------------------------------------

  /**
   * GET /:jobId/play
   * JSON `{ url }` for `<video src>` — presigned S3 or same-origin /files/… route.
   */
  router.get('/:jobId/play', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendApi(res, await getStoryPlayUrlService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  /** GET /:jobId/subtitles.srt — sidecar SRT when subtitleMode includes sidecar/both. */
  router.get('/:jobId/subtitles.srt', async (req, res) => {
    sendFileResult(
      res,
      await getStorySubtitlesFileService({ env, userId: userIdFrom(req), jobId: req.params.jobId })
    );
  });

  /** GET /files/:jobId/original — source upload on disk (editor crop/monitor; local dev). */
  router.get('/files/:jobId/original', async (req, res) => {
    sendFileResult(res, await getOriginalVideoFileService({ userId: userIdFrom(req), jobId: req.params.jobId }));
  });

  /** GET /files/:jobId/output.mp4 — rendered MP4 on disk when S3 output is not used. */
  router.get('/files/:jobId/output.mp4', async (req, res) => {
    sendFileResult(
      res,
      await getOutputVideoFileService({ env, userId: userIdFrom(req), jobId: req.params.jobId })
    );
  });

  // -------------------------------------------------------------------------
  // Editor re-render
  // -------------------------------------------------------------------------

  /**
   * POST /:jobId/edit
   * Body: `{ timeline?, render? }` — save clip edits; `render: true` kicks off async re-export
   * (runStoryRerenderJob in storyVideoService). Poll /status until completed again.
   */
  router.post('/:jobId/edit', async (req, res) => {
    sendApi(
      res,
      await editStoryJobService({
        userId: userIdFrom(req),
        jobId: req.params.jobId,
        body: req.body as Record<string, unknown>,
      })
    );
  });

  return router;
}
