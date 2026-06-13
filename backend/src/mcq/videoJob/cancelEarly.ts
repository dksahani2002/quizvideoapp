import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { isCancelRequested } from './progress.js';

/** If the user requested cancel before work starts, persist terminal state and return true. */
export async function cancelJobIfAlreadyRequested(videoId: string): Promise<boolean> {
  if (!(await isCancelRequested(videoId))) {
    return false;
  }
  await Video.findByIdAndUpdate(videoId, {
    status: 'failed',
    lastError: 'Cancelled',
    progressStage: 'cancelled',
    progressMessage: 'Cancelled',
  }).catch(() => {});
  await VideoJob.findOneAndUpdate(
    { videoId },
    {
      $set: { status: 'cancelled', stage: 'cancelled', message: 'Cancelled' },
      $push: { events: { at: new Date(), stage: 'cancelled', message: 'Cancelled' } },
    }
  ).catch(() => {});
  return true;
}
