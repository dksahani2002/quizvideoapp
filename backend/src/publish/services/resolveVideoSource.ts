import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import type { EnvConfig } from '../../common/config/envConfig.js';
import { StoryVideoJob } from '../../common/db/models/StoryVideoJob.js';
import { TrailerBreakdownJob } from '../../common/db/models/TrailerBreakdownJob.js';
import { Video } from '../../common/db/models/Video.js';
import { downloadObjectToFile } from '../../common/services/s3Storage.js';

export type PublishVideoSource =
  | { kind: 'story'; storyVideoJobId: string }
  | { kind: 'trailer'; trailerBreakdownJobId: string }
  | { kind: 'latest-mcq' };

export type ResolvedPublishOutput = {
  outputDir: string;
  title: string;
};

export async function resolvePublishOutput(
  userId: string,
  source: {
    storyVideoJobId?: string;
    trailerBreakdownJobId?: string;
  },
  envConfig: EnvConfig
): Promise<ResolvedPublishOutput> {
  if (source.storyVideoJobId && source.trailerBreakdownJobId) {
    throw new Error('Provide either storyVideoJobId or trailerBreakdownJobId, not both');
  }

  if (source.trailerBreakdownJobId) {
    if (!mongoose.Types.ObjectId.isValid(source.trailerBreakdownJobId)) {
      throw new Error('Invalid trailer breakdown job id');
    }
    const tj = await TrailerBreakdownJob.findOne({
      _id: source.trailerBreakdownJobId,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'completed',
    }).lean();
    if (!tj) throw new Error('Trailer breakdown job not found or not completed');

    const title = (tj.breakdownTitle || tj.movieTitle || 'Trailer breakdown').trim() || 'Trailer breakdown';
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId, 'trailer-publish');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `trailer-${String(tj._id)}.mp4`);

    if (tj.s3Bucket && tj.outputVideoKey) {
      await downloadObjectToFile(tj.s3Bucket, tj.outputVideoKey, outPath);
    } else {
      const fp = (tj.intermediate as { finalPath?: string } | undefined)?.finalPath;
      if (!fp || !fs.existsSync(fp)) {
        throw new Error(
          'Trailer breakdown output is not on disk (use S3 output bucket) or path missing — cannot upload to YouTube'
        );
      }
      fs.copyFileSync(fp, outPath);
    }
    return { outputDir: tmpDir, title };
  }

  if (source.storyVideoJobId) {
    if (!mongoose.Types.ObjectId.isValid(source.storyVideoJobId)) {
      throw new Error('Invalid story video job id');
    }
    const sj = await StoryVideoJob.findOne({
      _id: source.storyVideoJobId,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'completed',
    }).lean();
    if (!sj) throw new Error('Story video job not found or not completed');

    const title = 'Story video';
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId, 'story-publish');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `story-${String(sj._id)}.mp4`);

    if (sj.s3Bucket && sj.outputVideoKey) {
      await downloadObjectToFile(sj.s3Bucket, sj.outputVideoKey, outPath);
    } else {
      const fp = (sj.intermediate as { finalPath?: string } | undefined)?.finalPath;
      if (!fp || !fs.existsSync(fp)) {
        throw new Error(
          'Story video output is not on disk (use S3 output bucket) or path missing — cannot upload to YouTube'
        );
      }
      fs.copyFileSync(fp, outPath);
    }
    return { outputDir: tmpDir, title };
  }

  // Latest MCQ video
  const latest = await Video.findOne({ userId, status: 'completed' }).sort({ createdAt: -1 }).lean();
  if (latest?.s3Bucket && latest?.s3Key) {
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, latest.filename || 'latest.mp4');
    await downloadObjectToFile(latest.s3Bucket, latest.s3Key, outPath);
    return { outputDir: tmpDir, title: envConfig.TOPIC || 'Quiz' };
  }

  return { outputDir: path.join(envConfig.OUTPUT_DIR, userId), title: envConfig.TOPIC || 'Quiz' };
}
