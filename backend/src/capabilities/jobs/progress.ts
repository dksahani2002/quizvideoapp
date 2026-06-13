import type { Model } from 'mongoose';
import type { JobProgressFields } from './types.js';

export function createJobProgressHelpers<T extends JobProgressFields>(model: Model<T>) {
  async function pushEvent(job: T, stage: string, message: string) {
    const ev = [...(job.events || []), { at: new Date(), stage, message }];
    job.events = ev.slice(-300) as T['events'];
  }

  async function setProgress(job: T, pct: number, stage: string, message: string) {
    job.progressPercent = Math.min(100, Math.max(0, pct));
    job.stage = stage;
    job.progressMessage = message;
    await pushEvent(job, stage, message);
    await job.save();
  }

  async function isCancelled(jobId: string): Promise<boolean> {
    const j = await model.findById(jobId).select('cancelRequested').lean();
    return !!(j && (j as { cancelRequested?: boolean }).cancelRequested);
  }

  async function markCancelled(job: T) {
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.progressMessage = 'Cancelled';
    job.progressPercent = 0;
    job.idempotencyKey = '';
    await pushEvent(job, 'cancelled', 'Cancelled by user');
    await job.save();
  }

  async function failJobPermanent(job: T, error: string) {
    job.status = 'failed';
    job.stage = 'failed';
    job.error = error;
    job.progressMessage = error;
    job.progressPercent = 0;
    job.idempotencyKey = '';
    await pushEvent(job, 'failed', error);
    await job.save();
  }

  return { pushEvent, setProgress, isCancelled, markCancelled, failJobPermanent };
}
