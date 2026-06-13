import { Video } from '../../common/db/models/Video.js';
import { queueVideoJob } from '../utils/queueVideoJob.js';

/** Re-queue videos stuck in `generating` (e.g. after a crash or deploy). */
export async function retryStuckJobs(): Promise<void> {
  const stuck = await Video.find({ status: 'generating' }).limit(20);
  for (const v of stuck) {
    void queueVideoJob(v._id.toString());
  }
}
