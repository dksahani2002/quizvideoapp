/**
 * Trailer breakdown HTTP controller.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { EnvConfig } from '../../common/config/envConfig.js';
import {
  type TrailerApiResult,
  type TrailerFileResult,
  createTrailerBreakdownJobService,
  listTrailerJobsService,
  getTrailerJobStatusService,
  getTrailerJobResultService,
  getTrailerPlayUrlService,
  cancelTrailerJobService,
  retryTrailerJobService,
  patchTrailerScriptService,
  patchTrailerOptionsService,
  renderTrailerJobService,
  getTrailerOutputFileService,
} from '../services/trailerBreakdownService.js';

type RequestWithUser = Request & { user: { id: string } };

function userIdFrom(req: Request): string {
  return (req as RequestWithUser).user.id;
}

function sendApi(res: Response, result: TrailerApiResult): void {
  res.status(result.status).json(result.body);
}

function sendFileResult(res: Response, result: TrailerFileResult): void {
  if (result.kind === 'json') {
    res.status(result.status).json(result.body);
    return;
  }
  for (const [header, value] of Object.entries(result.headers || {})) {
    res.setHeader(header, value);
  }
  res.sendFile(result.path);
}

export function createTrailerBreakdownRoutes(env: EnvConfig): Router {
  const router = Router();

  router.post('/create', async (req, res) => {
    const result = await createTrailerBreakdownJobService({
      userId: userIdFrom(req),
      body: req.body as Record<string, unknown>,
      idempotencyKeyRaw: req.headers['idempotency-key'],
    });
    sendApi(res, result);
  });

  router.get('/jobs', async (req, res) => {
    const result = await listTrailerJobsService({
      userId: userIdFrom(req),
      limitRaw: req.query.limit,
    });
    sendApi(res, result);
  });

  router.get('/:jobId/status', async (req, res) => {
    const result = await getTrailerJobStatusService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.get('/:jobId/result', async (req, res) => {
    const result = await getTrailerJobResultService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.get('/:jobId/play', async (req, res) => {
    const result = await getTrailerPlayUrlService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.patch('/:jobId/script', async (req, res) => {
    const result = await patchTrailerScriptService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
      body: req.body as Record<string, unknown>,
    });
    sendApi(res, result);
  });

  router.patch('/:jobId/options', async (req, res) => {
    const result = await patchTrailerOptionsService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
      body: req.body as Record<string, unknown>,
    });
    sendApi(res, result);
  });

  router.post('/:jobId/render', async (req, res) => {
    const result = await renderTrailerJobService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.post('/:jobId/cancel', async (req, res) => {
    const result = await cancelTrailerJobService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.post('/:jobId/retry', async (req, res) => {
    const result = await retryTrailerJobService({
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendApi(res, result);
  });

  router.get('/files/:jobId/output.mp4', async (req, res) => {
    const result = await getTrailerOutputFileService({
      env,
      userId: userIdFrom(req),
      jobId: req.params.jobId,
    });
    sendFileResult(res, result);
  });

  return router;
}
