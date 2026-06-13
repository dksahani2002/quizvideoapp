import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { videoRowExists } from './progress.js';

export async function markJobFailed(videoId: string, err: unknown): Promise<void> {
  if (!(await videoRowExists(videoId))) return;
  const msg = err instanceof Error ? err.message : String(err);
  const cancelled = String(msg || '').toLowerCase().includes('cancel');
  await Video.findByIdAndUpdate(videoId, {
    status: 'failed',
    lastError: cancelled ? 'Cancelled' : msg,
    progressStage: cancelled ? 'cancelled' : 'failed',
    progressMessage: (cancelled ? 'Cancelled' : (msg || 'Failed')).slice(0, 500),
  }).catch(() => {});
  await VideoJob.findOneAndUpdate(
    { videoId },
    {
      $set: {
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'Cancelled' : (msg || 'Failed'),
      },
      $push: {
        events: {
          at: new Date(),
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? 'Cancelled' : (msg || 'Failed'),
        },
      },
    }
  ).catch(() => {});
}
