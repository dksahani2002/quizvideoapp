import fs from 'fs';
import path from 'path';
import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { uploadFileToS3 } from '../../common/services/s3Storage.js';
import { videoRowExists } from './progress.js';

/**
 * Pick newest `quiz_video_*.mp4` in the output dir, optionally upload to S3, mark job completed.
 */
export async function finalizeCompletedVideo(params: {
  videoId: string;
  userId: string;
  userVideoDir: string;
}): Promise<void> {
  const { videoId, userId, userVideoDir } = params;

  const resolvedDir = path.resolve(userVideoDir);
  const outputFiles = fs
    .readdirSync(resolvedDir)
    .filter((f) => f.startsWith('quiz_video_') && f.endsWith('.mp4'))
    .sort((a, b) => {
      const sa = fs.statSync(path.join(resolvedDir, a));
      const sb = fs.statSync(path.join(resolvedDir, b));
      return sb.mtimeMs - sa.mtimeMs;
    });

  if (outputFiles.length === 0) {
    if (!(await videoRowExists(videoId))) return;
    await Video.findByIdAndUpdate(videoId, {
      status: 'failed',
      lastError: 'No output video produced',
      progressStage: 'failed',
      progressMessage: 'Failed: no output produced',
    });
    return;
  }

  const latestFile = outputFiles[0];
  const localPath = path.join(resolvedDir, latestFile);
  const stat = fs.statSync(localPath);
  const resolvedPath = path.resolve(localPath);
  const s3Bucket = process.env.S3_OUTPUT_BUCKET?.trim();
  let s3Key = '';
  if (s3Bucket) {
    s3Key = `${userId}/${latestFile}`;
    await uploadFileToS3(s3Bucket, s3Key, localPath);
  }

  await Video.findByIdAndUpdate(videoId, {
    status: 'completed',
    size: stat.size,
    filename: latestFile,
    filePath: resolvedPath,
    ...(s3Bucket && s3Key ? { s3Bucket, s3Key } : {}),
    lastError: '',
    progressStage: 'completed',
    progressMessage: 'Completed',
  });
  await VideoJob.findOneAndUpdate(
    { videoId },
    {
      $set: { status: 'completed', stage: 'completed', message: 'Completed' },
      $push: { events: { at: new Date(), stage: 'completed', message: 'Completed' } },
    }
  ).catch(() => {});
}
