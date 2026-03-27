import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { VideoJob } from '../db/models/VideoJob.js';
import { Video } from '../db/models/Video.js';
import { queueVideoJob } from '../utils/queueVideoJob.js';

async function resolveVideoJobId(userId: string, rawId: string): Promise<string | null> {
  const id = (rawId || '').trim();
  if (!id) return null;
  if (mongoose.isValidObjectId(id)) return id;
  // Backwards-compat: some older records use a render id like `quiz_video_...` in `Video.jobId`.
  const v = await Video.findOne({ userId, jobId: id }).select('_id').lean();
  if (!v?._id) return null;
  const job = await VideoJob.findOne({ userId, videoId: v._id }).sort({ createdAt: -1 }).select('_id').lean();
  return job?._id ? job._id.toString() : null;
}

export function createJobsRoutes(): Router {
  const router = Router();

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const resolvedId = await resolveVideoJobId(userId, req.params.id);
      if (!resolvedId) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      const job = await VideoJob.findOne({ _id: resolvedId, userId }).lean();
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      res.json({
        success: true,
        data: {
          id: job._id.toString(),
          videoId: job.videoId.toString(),
          status: job.status,
          attempts: job.attempts || 0,
          cancelRequested: !!job.cancelRequested,
          stage: job.stage || '',
          message: job.message || '',
          events: (job.events || []).map((e: any) => ({ at: new Date(e.at).toISOString(), stage: e.stage, message: e.message })),
          createdAt: new Date(job.createdAt).toISOString(),
          updatedAt: new Date(job.updatedAt).toISOString(),
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const resolvedId = await resolveVideoJobId(userId, req.params.id);
      if (!resolvedId) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      const job = await VideoJob.findOneAndUpdate(
        { _id: resolvedId, userId },
        { $set: { cancelRequested: true, status: 'cancelled', stage: 'cancel', message: 'Cancellation requested' }, $push: { events: { at: new Date(), stage: 'cancel', message: 'Cancellation requested' } } },
        { new: true }
      );
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      await Video.findOneAndUpdate({ _id: job.videoId, userId, status: 'generating' }, { $set: { progressStage: 'cancel', progressMessage: 'Cancelling...', lastError: '' } }).catch(() => {});
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  router.post('/:id/retry', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const resolvedId = await resolveVideoJobId(userId, req.params.id);
      if (!resolvedId) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      const job = await VideoJob.findOne({ _id: resolvedId, userId });
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      job.cancelRequested = false;
      job.status = 'queued';
      job.stage = 'queued';
      job.message = 'Queued for retry';
      job.attempts = (job.attempts || 0) + 1;
      job.events = [...(job.events || []), { at: new Date(), stage: 'retry', message: 'Queued for retry' }];
      await job.save();
      await Video.findOneAndUpdate({ _id: job.videoId, userId }, { $set: { status: 'generating', lastError: '', progressStage: 'queued', progressMessage: 'Queued for retry' } }).catch(() => {});
      void queueVideoJob(job.videoId.toString());
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  return router;
}

// Backward-compatible alias while normalizing route factory naming.
export const createJobRoutes = createJobsRoutes;

