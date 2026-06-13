import mongoose from 'mongoose';

import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { queueVideoJob } from '../utils/queueVideoJob.js';

export interface JobServiceResult {
  status: number;
  body: Record<string, unknown>;
}

export async function resolveVideoJobId(userId: string, rawId: string): Promise<string | null> {
  const id = (rawId || '').trim();
  if (!id) return null;
  if (mongoose.isValidObjectId(id)) return id;
  // Backwards-compat: some older records use a render id like `quiz_video_...` in `Video.jobId`.
  const v = await Video.findOne({ userId, jobId: id }).select('_id').lean();
  if (!v?._id) return null;
  const job = await VideoJob.findOne({ userId, videoId: v._id }).sort({ createdAt: -1 }).select('_id').lean();
  return job?._id ? job._id.toString() : null;
}

export async function getJob(userId: string, rawId: string): Promise<JobServiceResult> {
  try {
    const resolvedId = await resolveVideoJobId(userId, rawId);
    if (!resolvedId) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    const job = await VideoJob.findOne({ _id: resolvedId, userId }).lean();
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: job._id.toString(),
          videoId: job.videoId.toString(),
          status: job.status,
          attempts: job.attempts || 0,
          cancelRequested: !!job.cancelRequested,
          stage: job.stage || '',
          message: job.message || '',
          events: (job.events || []).map((e: any) => ({
            at: new Date(e.at).toISOString(),
            stage: e.stage,
            message: e.message,
          })),
          createdAt: new Date(job.createdAt).toISOString(),
          updatedAt: new Date(job.updatedAt).toISOString(),
        },
      },
    };
  } catch (e) {
    return { status: 500, body: { success: false, error: String(e) } };
  }
}

export async function cancelJob(userId: string, rawId: string): Promise<JobServiceResult> {
  try {
    const resolvedId = await resolveVideoJobId(userId, rawId);
    if (!resolvedId) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    const job = await VideoJob.findOneAndUpdate(
      { _id: resolvedId, userId },
      {
        $set: {
          cancelRequested: true,
          status: 'cancelled',
          stage: 'cancel',
          message: 'Cancellation requested',
        },
        $push: { events: { at: new Date(), stage: 'cancel', message: 'Cancellation requested' } },
      },
      { new: true }
    );
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    await Video.findOneAndUpdate(
      { _id: job.videoId, userId, status: 'generating' },
      { $set: { progressStage: 'cancel', progressMessage: 'Cancelling...', lastError: '' } }
    ).catch(() => {});

    return { status: 200, body: { success: true } };
  } catch (e) {
    return { status: 500, body: { success: false, error: String(e) } };
  }
}

export async function retryJob(userId: string, rawId: string): Promise<JobServiceResult> {
  try {
    const resolvedId = await resolveVideoJobId(userId, rawId);
    if (!resolvedId) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    const job = await VideoJob.findOne({ _id: resolvedId, userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    job.cancelRequested = false;
    job.status = 'queued';
    job.stage = 'queued';
    job.message = 'Queued for retry';
    job.attempts = (job.attempts || 0) + 1;
    job.events = [...(job.events || []), { at: new Date(), stage: 'retry', message: 'Queued for retry' }];
    await job.save();

    await Video.findOneAndUpdate(
      { _id: job.videoId, userId },
      { $set: { status: 'generating', lastError: '', progressStage: 'queued', progressMessage: 'Queued for retry' } }
    ).catch(() => {});

    void queueVideoJob(job.videoId.toString());
    return { status: 200, body: { success: true } };
  } catch (e) {
    return { status: 500, body: { success: false, error: String(e) } };
  }
}
