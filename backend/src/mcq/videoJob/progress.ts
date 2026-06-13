import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';

export async function setVideoProgress(videoId: string, stage: string, message: string): Promise<void> {
  await Video.findByIdAndUpdate(videoId, {
    progressStage: stage,
    progressMessage: message,
  }).catch(() => {});
}

export async function appendJobEvent(videoId: string, stage: string, message: string): Promise<void> {
  await VideoJob.findOneAndUpdate(
    { videoId },
    {
      $set: { stage, message },
      $push: { events: { at: new Date(), stage, message } },
    }
  ).catch(() => {});
}

export async function isCancelRequested(videoId: string): Promise<boolean> {
  const job = await VideoJob.findOne({ videoId }).select('cancelRequested status').lean();
  return !!(job && (job.cancelRequested || job.status === 'cancelled'));
}

/** False if the video row was deleted (e.g. user cancelled while generating). */
export async function videoRowExists(videoId: string): Promise<boolean> {
  const v = await Video.findById(videoId).select('_id').lean();
  return !!v;
}
