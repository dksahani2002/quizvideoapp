import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import type { EnvConfig } from '../../common/config/envConfig.js';
import {
  TrailerBreakdownJob,
  type BreakdownSegment,
  type TrailerJobOptionsDoc,
} from '../../common/db/models/TrailerBreakdownJob.js';
import { getPresignedGetUrl } from '../../common/services/s3Storage.js';
import { queueTrailerBreakdownJob } from '../pipeline/queue.js';
import { runTrailerRerenderJob } from '../pipeline/run.js';
import { isValidYoutubeUrl } from '../io/youtubeDownload.js';

type SuccessBody = { success: true; data?: unknown; url?: string };
type ErrorBody = { success: false; error: string; hint?: string };
export type TrailerApiResult = { status: number; body: SuccessBody | ErrorBody };

export type TrailerFileResult =
  | { kind: 'file'; path: string; headers?: Record<string, string> }
  | { kind: 'json'; status: number; body: ErrorBody };

interface JobParams {
  userId: string;
  jobId: string;
}

function internalError(e: unknown): TrailerApiResult {
  return {
    status: 500,
    body: { success: false, error: e instanceof Error ? e.message : String(e) },
  };
}

function normalizeIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 128);
}

function parseOptions(raw: unknown): TrailerJobOptionsDoc {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ttsProvider = o.ttsProvider;
  const exportPreset = o.exportPreset;
  const sceneDetectionMode = o.sceneDetectionMode;
  const ttsModel = typeof o.ttsModel === 'string' ? o.ttsModel.trim() : '';
  return {
    ttsProvider:
      ttsProvider === 'openai' ||
      ttsProvider === 'elevenlabs' ||
      ttsProvider === 'system' ||
      ttsProvider === 'inherit'
        ? ttsProvider
        : 'inherit',
    ttsVoice: typeof o.ttsVoice === 'string' ? o.ttsVoice.trim() : '',
    ttsModel: ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1',
    systemVoice: typeof o.systemVoice === 'string' ? o.systemVoice.trim() : '',
    elevenlabsModelId: typeof o.elevenlabsModelId === 'string' ? o.elevenlabsModelId.trim() : '',
    exportPreset:
      exportPreset === 'fast' || exportPreset === 'balanced' || exportPreset === 'quality'
        ? exportPreset
        : 'balanced',
    sceneDetectionMode:
      sceneDetectionMode === 'ffmpeg' ||
      sceneDetectionMode === 'pyscenedetect' ||
      sceneDetectionMode === 'hybrid'
        ? sceneDetectionMode
        : 'ffmpeg',
    narrationLanguage: typeof o.narrationLanguage === 'string' ? o.narrationLanguage.trim() || 'en' : 'en',
    ffmpegSceneThreshold:
      typeof o.ffmpegSceneThreshold === 'number' && o.ffmpegSceneThreshold > 0
        ? o.ffmpegSceneThreshold
        : 0.32,
  };
}

function isValidSegment(s: unknown): s is BreakdownSegment {
  if (!s || typeof s !== 'object') return false;
  const seg = s as Record<string, unknown>;
  return (
    typeof seg.id === 'string' &&
    typeof seg.startSec === 'number' &&
    typeof seg.endSec === 'number' &&
    typeof seg.narration === 'string' &&
    seg.narration.trim().length > 0
  );
}

export async function createTrailerBreakdownJobService(params: {
  userId: string;
  body: Record<string, unknown>;
  idempotencyKeyRaw: unknown;
}): Promise<TrailerApiResult> {
  const { userId, body, idempotencyKeyRaw } = params;
  const idemKey = normalizeIdempotencyKey(idempotencyKeyRaw);
  const maxAttempts = Math.max(1, parseInt(process.env.TRAILER_BREAKDOWN_MAX_JOB_ATTEMPTS || '3', 10));

  try {
    if (idemKey) {
      const existing = await TrailerBreakdownJob.findOne({ userId, idempotencyKey: idemKey }).lean();
      if (existing && ['pending', 'processing', 'completed'].includes(existing.status)) {
        return {
          status: 200,
          body: {
            success: true,
            data: {
              jobId: existing._id.toString(),
              status: existing.status,
              idempotentReplay: true,
            },
          },
        };
      }
    }

    const youtubeUrl = typeof body.youtubeUrl === 'string' ? body.youtubeUrl.trim() : '';
    if (!youtubeUrl || !isValidYoutubeUrl(youtubeUrl)) {
      return {
        status: 400,
        body: { success: false, error: 'Provide a valid YouTube URL (youtube.com or youtu.be)' },
      };
    }

    const movieTitle = typeof body.movieTitle === 'string' ? body.movieTitle.trim() : '';
    const options = parseOptions(body.options);

    const job = await TrailerBreakdownJob.create({
      userId,
      idempotencyKey: idemKey,
      maxAttempts,
      youtubeUrl,
      movieTitle,
      options,
      status: 'pending',
      stage: 'queued',
      progressMessage: 'Queued',
    });

    await queueTrailerBreakdownJob(job._id.toString());

    return {
      status: 201,
      body: {
        success: true,
        data: { jobId: job._id.toString(), status: job.status, options: job.options },
      },
    };
  } catch (e: unknown) {
    if (e && typeof e === 'object' && (e as { code?: number }).code === 11000) {
      return { status: 409, body: { success: false, error: 'Duplicate idempotency key' } };
    }
    return internalError(e);
  }
}

export async function listTrailerJobsService(params: {
  userId: string;
  limitRaw: unknown;
}): Promise<TrailerApiResult> {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(params.limitRaw || '50'), 10) || 50));
    const jobs = await TrailerBreakdownJob.find({ userId: params.userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select(
        '_id status stage progressMessage progressPercent error createdAt updatedAt youtubeUrl movieTitle breakdownTitle breakdownScript'
      )
      .lean();

    const data = jobs.map((j) => {
      const firstNarration = (j.breakdownScript?.[0]?.narration || '').trim().replace(/\s+/g, ' ');
      const preview = firstNarration.length > 120 ? `${firstNarration.slice(0, 120)}…` : firstNarration;
      return {
        jobId: j._id.toString(),
        status: j.status,
        stage: j.stage,
        progressMessage: j.progressMessage || '',
        progressPercent: j.progressPercent ?? 0,
        error: j.error || '',
        youtubeUrl: j.youtubeUrl,
        movieTitle: j.movieTitle || j.breakdownTitle || '',
        scriptPreview: preview,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      };
    });

    return { status: 200, body: { success: true, data } };
  } catch (e) {
    return internalError(e);
  }
}

export async function getTrailerJobStatusService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    const job = await TrailerBreakdownJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    return {
      status: 200,
      body: {
        success: true,
        data: {
          jobId: job._id.toString(),
          status: job.status,
          stage: job.stage,
          progressMessage: job.progressMessage,
          progressPercent: job.progressPercent,
          error: job.error,
          events: (job.events || []).slice(-20),
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function getTrailerJobResultService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    return {
      status: 200,
      body: {
        success: true,
        data: {
          jobId: job._id.toString(),
          status: job.status,
          breakdownTitle: job.breakdownTitle,
          movieTitle: job.movieTitle,
          youtubeUrl: job.youtubeUrl,
          breakdownScript: job.breakdownScript,
          outputVideoUrl: job.outputVideoUrl,
          options: job.options,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function getTrailerPlayUrlService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: jobId, userId }).lean();
    if (!job || job.status !== 'completed') {
      return { status: 404, body: { success: false, error: 'Export not ready' } };
    }
    if (job.s3Bucket && job.outputVideoKey) {
      const url = await getPresignedGetUrl(job.s3Bucket, job.outputVideoKey, 86400);
      return { status: 200, body: { success: true, url } };
    }
    return { status: 200, body: { success: true, url: `/api/trailer-breakdown/files/${jobId}/output.mp4` } };
  } catch (e) {
    return internalError(e);
  }
}

export async function cancelTrailerJobService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOneAndUpdate(
      { _id: jobId, userId, status: { $in: ['pending', 'processing'] } },
      {
        $set: { cancelRequested: true, progressMessage: 'Cancellation requested…' },
        $push: { events: { at: new Date(), stage: 'cancel', message: 'Cancellation requested' } },
      },
      { new: true }
    );
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found or not cancellable' } };
    }
    return { status: 200, body: { success: true } };
  } catch (e) {
    return internalError(e);
  }
}

export async function retryTrailerJobService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: jobId, userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    if (!['failed', 'cancelled'].includes(job.status)) {
      return { status: 400, body: { success: false, error: 'Only failed or cancelled jobs can be retried' } };
    }

    const workDir =
      job.intermediate?.workDir ||
      path.join(process.env.TEMP_DIR || './temp', 'trailer-breakdown', userId, jobId);
    const sourcePath = job.intermediate?.sourceVideoPath || path.join(workDir, 'source.mp4');
    const hasSource = fs.existsSync(sourcePath);
    const hasScript = (job.breakdownScript?.length ?? 0) > 0;

    job.status = 'pending';
    job.stage = 'queued';
    job.progressMessage =
      hasSource && hasScript
        ? 'Retry queued — resuming from render (cached trailer & script)'
        : 'Retry queued';
    job.progressPercent = 0;
    job.error = '';
    job.cancelRequested = false;
    await job.save();

    const opts =
      hasSource && hasScript ? { renderOnly: true as const, forceRerender: false } : {};
    await queueTrailerBreakdownJob(jobId, opts);

    return { status: 200, body: { success: true, data: { jobId, status: 'pending' } } };
  } catch (e) {
    return internalError(e);
  }
}

export async function patchTrailerScriptService(params: {
  userId: string;
  jobId: string;
  body: Record<string, unknown>;
}): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: params.jobId, userId: params.userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    const raw = params.body.breakdownScript;
    if (!Array.isArray(raw)) {
      return { status: 400, body: { success: false, error: 'breakdownScript must be an array' } };
    }
    const segments = raw.filter(isValidSegment);
    if (segments.length === 0) {
      return { status: 400, body: { success: false, error: 'At least one valid segment required' } };
    }
    job.breakdownScript = segments.map((s) => ({
      id: s.id,
      startSec: s.startSec,
      endSec: s.endSec,
      label: s.label || '',
      narration: s.narration.trim(),
      onScreenText: s.onScreenText || '',
    }));
    if (typeof params.body.breakdownTitle === 'string' && params.body.breakdownTitle.trim()) {
      job.breakdownTitle = params.body.breakdownTitle.trim();
    }
    await job.save();
    return { status: 200, body: { success: true, data: { breakdownScript: job.breakdownScript } } };
  } catch (e) {
    return internalError(e);
  }
}

export async function patchTrailerOptionsService(params: {
  userId: string;
  jobId: string;
  body: Record<string, unknown>;
}): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: params.jobId, userId: params.userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    if (params.body.options != null) {
      job.options = parseOptions(params.body.options);
    }
    await job.save();
    return { status: 200, body: { success: true, data: { options: job.options } } };
  } catch (e) {
    return internalError(e);
  }
}

export async function renderTrailerJobService({ userId, jobId }: JobParams): Promise<TrailerApiResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: jobId, userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    if (!job.breakdownScript?.length) {
      return { status: 400, body: { success: false, error: 'No breakdown script to render' } };
    }
    job.status = 'processing';
    job.stage = 're_render';
    job.progressMessage = 'Re-render started';
    job.progressPercent = 5;
    job.error = '';
    await job.save();
    void runTrailerRerenderJob(jobId);
    return { status: 202, body: { success: true, data: { jobId, status: 'processing' } } };
  } catch (e) {
    return internalError(e);
  }
}

export async function getTrailerOutputFileService(params: {
  env: EnvConfig;
  userId: string;
  jobId: string;
}): Promise<TrailerFileResult> {
  try {
    const job = await TrailerBreakdownJob.findOne({ _id: params.jobId, userId: params.userId }).lean();
    if (!job) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Job not found' } };
    }
    const finalPath =
      job.intermediate?.finalPath ||
      path.join(params.env.TEMP_DIR, 'trailer-breakdown', params.userId, params.jobId, 'breakdown_output.mp4');
    if (!fs.existsSync(finalPath)) {
      return {
        kind: 'json',
        status: 404,
        body: { success: false, error: 'Output not available on disk (use S3 URL)' },
      };
    }
    return {
      kind: 'file',
      path: path.resolve(finalPath),
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'inline; filename="trailer-breakdown.mp4"',
      },
    };
  } catch (e) {
    return {
      kind: 'json',
      status: 500,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}
