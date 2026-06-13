import type { Model } from 'mongoose';
import type { RetryableJobFields } from './types.js';
import type { createJobProgressHelpers } from './progress.js';

export function createRetryScheduler<T extends RetryableJobFields>(
  model: Model<T>,
  options: {
    maxAttemptsEnvKey: string;
    defaultMax: number;
    requeue: (jobId: string, job: T) => void | Promise<void>;
  }
) {
  function maxJobAttempts(job: T): number {
    const n = job.maxAttempts;
    if (n && n > 0) return n;
    return Math.max(1, parseInt(process.env[options.maxAttemptsEnvKey] || String(options.defaultMax), 10));
  }

  return async function scheduleRetryOrFail(
    jobId: string,
    error: string,
    helpers: ReturnType<typeof createJobProgressHelpers<T>>
  ): Promise<void> {
    const job = await model.findById(jobId);
    if (!job) return;
    const max = maxJobAttempts(job);
    if (await helpers.isCancelled(job._id.toString())) {
      await helpers.failJobPermanent(job, error);
      return;
    }
    if (job.attempts < max) {
      job.status = 'pending';
      job.stage = 'queued';
      job.progressMessage = `Will retry (${job.attempts}/${max}): ${error.slice(0, 200)}`;
      job.error = error;
      job.progressPercent = 0;
      await helpers.pushEvent(job, 'retry_scheduled', error);
      await job.save();
      const delay = Math.min(120_000, 3000 * Math.pow(2, Math.max(0, job.attempts - 1)));
      setTimeout(() => {
        void options.requeue(jobId, job);
      }, delay);
      return;
    }
    await helpers.failJobPermanent(job, error);
  };
}
