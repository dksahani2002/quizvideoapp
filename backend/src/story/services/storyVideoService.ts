import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import type { EnvConfig } from '../../common/config/envConfig.js';
import { StoryVideoJob, type StoryTimeline } from '../../common/db/models/StoryVideoJob.js';
import {
  uploadFileToS3IfAbsent,
  getPresignedGetUrl,
  getPresignedPutUrl,
  resolveUserUploadsBucket,
} from '../../common/services/s3Storage.js';
import { resolvePathUnderAssetsDir } from '../../common/config/paths.js';
import { queueStoryVideoJob } from '../queueStoryVideoJob.js';
import { runStoryRerenderJob } from '../pipeline.js';
import { parseStoryOptionsFromBody } from '../storyOptions.js';
import { normalizeIdempotencyKey } from '../idempotency.js';
import { parseS3Uri } from '../s3InputUri.js';
import {
  inferStoryUploadExt,
  defaultContentTypeForExt,
  allowDevAssetInputs,
  storyProductionUsesRemoteUrlsOnly,
  isHttpUrl,
  extFromAssetUrl,
  cleanupMulterFiles,
  contentTypeForOriginalVideo,
  mediaKindFromExt,
} from './storyVideoMedia.js';

type StorySuccessBody = {
  success: true;
  data?: unknown;
  url?: string;
};

type StoryErrorBody = {
  success: false;
  error: string;
  hint?: string;
};

export type StoryApiResult = {
  status: number;
  body: StorySuccessBody | StoryErrorBody;
};

export type StoryFileResult =
  | {
      kind: 'file';
      path: string;
      headers?: Record<string, string>;
    }
  | {
      kind: 'json';
      status: number;
      body: StoryErrorBody;
    };

type StoryUploadFieldMap = Partial<Record<'video' | 'audio' | 'bgm', Express.Multer.File[]>>;

interface CreateStoryVideoJobParams {
  env: EnvConfig;
  userId: string;
  body: Record<string, unknown>;
  files: StoryUploadFieldMap | undefined;
  idempotencyKeyRaw: unknown;
}

interface PresignStoryUploadParams {
  userId: string;
  body: Record<string, unknown>;
}

interface UploadUserMediaParams {
  userId: string;
  body: Record<string, unknown>;
  file: Express.Multer.File | undefined;
}

interface ResolveUserMediaFileParams {
  env: EnvConfig;
  authUserId: string;
  userId: string;
  filename: string;
}

interface StoryJobParams {
  userId: string;
  jobId: string;
}

interface ListStoryJobsParams {
  userId: string;
  limitRaw: unknown;
}

interface EditStoryJobParams extends StoryJobParams {
  body: Record<string, unknown>;
}

interface StoryFileJobParams extends StoryJobParams {
  env: EnvConfig;
}

interface MongoDuplicateError {
  code?: number;
}

function internalError(e: unknown): StoryApiResult {
  return {
    status: 500,
    body: { success: false, error: e instanceof Error ? e.message : String(e) },
  };
}

export async function createStoryVideoJobService({
  env,
  userId,
  body,
  files,
  idempotencyKeyRaw,
}: CreateStoryVideoJobParams): Promise<StoryApiResult> {
  const idemKey = normalizeIdempotencyKey(idempotencyKeyRaw);
  const maxAttempts = Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10));
  try {
    if (idemKey) {
      const existing = await StoryVideoJob.findOne({ userId, idempotencyKey: idemKey }).lean();
      if (existing && ['pending', 'processing', 'completed'].includes(existing.status)) {
        cleanupMulterFiles(files);
        return {
          status: 200,
          body: {
            success: true,
            data: {
              jobId: existing._id.toString(),
              status: existing.status,
              idempotentReplay: true,
              options: existing.options,
            },
          },
        };
      }
    }

    const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
    const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : '';
    const bgmSourceUrl = typeof body.bgmSourceUrl === 'string' ? body.bgmSourceUrl.trim() : '';
    const devVideoAsset = typeof body.devVideoAsset === 'string' ? body.devVideoAsset.trim() : '';
    const devAudioAsset = typeof body.devAudioAsset === 'string' ? body.devAudioAsset.trim() : '';
    const devBgmAsset = typeof body.devBgmAsset === 'string' ? body.devBgmAsset.trim() : '';

    const devAssetsAllowed = allowDevAssetInputs(env);
    const anyDevField = !!(devVideoAsset || devAudioAsset || devBgmAsset);
    if (anyDevField && !devAssetsAllowed) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: {
          success: false,
          error:
            'devVideoAsset/devAudioAsset/devBgmAsset are only allowed when NODE_ENV=development (use videoUrl/audioUrl/bgmSourceUrl in production)',
        },
      };
    }

    for (const u of [videoUrl, audioUrl, bgmSourceUrl]) {
      if (u && !isHttpUrl(u) && !parseS3Uri(u)) {
        cleanupMulterFiles(files);
        return {
          status: 400,
          body: { success: false, error: 'Asset URLs must be https links or s3://bucket/key' },
        };
      }
    }

    const videoFile = files?.video?.[0];
    const audioFile = files?.audio?.[0];
    const bgmFile = files?.bgm?.[0];
    const scriptText = typeof body.scriptText === 'string' ? body.scriptText.trim() : '';
    const options = parseStoryOptionsFromBody(body.options);

    if (storyProductionUsesRemoteUrlsOnly(env) && (videoFile?.path || audioFile?.path || bgmFile?.path)) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: {
          success: false,
          error:
            'In production, upload media to S3 (or use s3:// URIs readable by this server), then pass presigned HTTPS GET URLs via videoUrl, audioUrl, and bgmSourceUrl. Direct multipart uploads to this API are not supported.',
        },
      };
    }

    if (videoUrl && videoFile?.path) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either field video or videoUrl, not both' },
      };
    }
    if (devVideoAsset && (videoUrl || videoFile?.path)) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either devVideoAsset or video / videoUrl, not both' },
      };
    }
    if (!videoUrl && !videoFile?.path && !devVideoAsset) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Video file (field: video), videoUrl (https or s3://…), or devVideoAsset (dev) is required',
        },
      };
    }
    if (audioUrl && audioFile?.path) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either field audio or audioUrl, not both' },
      };
    }
    if (devAudioAsset && (audioUrl || audioFile?.path)) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either devAudioAsset or audio / audioUrl, not both' },
      };
    }
    if (bgmSourceUrl && bgmFile?.path) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either field bgm or bgmSourceUrl, not both' },
      };
    }
    if (devBgmAsset && (bgmSourceUrl || bgmFile?.path)) {
      cleanupMulterFiles(files);
      return {
        status: 400,
        body: { success: false, error: 'Provide either devBgmAsset or bgm / bgmSourceUrl, not both' },
      };
    }
    if (!scriptText && !audioFile?.path && !audioUrl && !devAudioAsset) {
      return {
        status: 400,
        body: {
          success: false,
          error:
            'Provide narration: script text (scriptText), and/or audio file (audio), and/or audioUrl (https or s3://…), and/or devAudioAsset (dev)',
        },
      };
    }

    const id = new mongoose.Types.ObjectId();
    const jobId = id.toString();
    const workDir = path.join(env.TEMP_DIR, 'story-video', userId, jobId);
    fs.mkdirSync(workDir, { recursive: true });
    const { downloadHttpToFileOrLocalUserMedia } = await import('../downloadAsset.js');
    let videoDest = '';
    let audioDest = '';
    let bgmDest = '';
    try {
      if (devVideoAsset) {
        const src = resolvePathUnderAssetsDir(devVideoAsset);
        if (!src) throw new Error(`Invalid or missing devVideoAsset: ${devVideoAsset}`);
        videoDest = path.join(workDir, `input${path.extname(src) || '.mp4'}`);
        fs.copyFileSync(src, videoDest);
      } else if (videoUrl) {
        videoDest = path.join(workDir, `input${extFromAssetUrl(videoUrl, '.mp4')}`);
        await downloadHttpToFileOrLocalUserMedia(videoUrl, videoDest);
      } else {
        videoDest = path.join(workDir, `input${path.extname(videoFile?.filename || '') || '.mp4'}`);
        fs.renameSync(videoFile!.path, videoDest);
      }

      if (devAudioAsset) {
        const src = resolvePathUnderAssetsDir(devAudioAsset);
        if (!src) throw new Error(`Invalid or missing devAudioAsset: ${devAudioAsset}`);
        audioDest = path.join(workDir, `narration${path.extname(src) || '.mp3'}`);
        fs.copyFileSync(src, audioDest);
      } else if (audioUrl) {
        audioDest = path.join(workDir, `narration${extFromAssetUrl(audioUrl, '.mp3')}`);
        await downloadHttpToFileOrLocalUserMedia(audioUrl, audioDest);
      } else if (audioFile?.path) {
        audioDest = path.join(workDir, `narration${path.extname(audioFile.filename) || '.mp3'}`);
        fs.renameSync(audioFile.path, audioDest);
      }

      if (devBgmAsset) {
        const src = resolvePathUnderAssetsDir(devBgmAsset);
        if (!src) throw new Error(`Invalid or missing devBgmAsset: ${devBgmAsset}`);
        bgmDest = path.join(workDir, `bgm${path.extname(src) || '.mp3'}`);
        fs.copyFileSync(src, bgmDest);
      } else if (bgmSourceUrl) {
        bgmDest = path.join(workDir, `bgm${extFromAssetUrl(bgmSourceUrl, '.mp3')}`);
        await downloadHttpToFileOrLocalUserMedia(bgmSourceUrl, bgmDest);
      } else if (bgmFile?.path) {
        bgmDest = path.join(workDir, `bgm${path.extname(bgmFile.filename) || '.mp3'}`);
        fs.renameSync(bgmFile.path, bgmDest);
      }
    } catch (e) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      cleanupMulterFiles(files);
      const msg = e instanceof Error ? e.message : String(e);
      return { status: 400, body: { success: false, error: `Failed to prepare assets: ${msg}` } };
    }

    const bucket = resolveUserUploadsBucket();
    let inputVideoUrl = '';
    let inputVideoKey = '';
    let inputAudioUrl = '';
    let inputAudioKey = '';
    let bgmKey = '';
    let jobBgmPresignedUrl = '';
    if (bucket) {
      inputVideoKey = `story-video/${userId}/${jobId}/input${path.extname(videoDest)}`;
      await uploadFileToS3IfAbsent(
        bucket,
        inputVideoKey,
        videoDest,
        defaultContentTypeForExt(path.extname(videoDest), 'video')
      );
      inputVideoUrl = await getPresignedGetUrl(bucket, inputVideoKey, 3600);

      if (audioDest) {
        inputAudioKey = `story-video/${userId}/${jobId}/narration${path.extname(audioDest)}`;
        const audioType = defaultContentTypeForExt(path.extname(audioDest), 'audio');
        await uploadFileToS3IfAbsent(bucket, inputAudioKey, audioDest, audioType);
        inputAudioUrl = await getPresignedGetUrl(bucket, inputAudioKey, 3600);
      }
      if (bgmDest) {
        bgmKey = `story-video/${userId}/${jobId}/bgm${path.extname(bgmDest)}`;
        await uploadFileToS3IfAbsent(bucket, bgmKey, bgmDest, 'audio/mpeg');
        jobBgmPresignedUrl = await getPresignedGetUrl(bucket, bgmKey, 3600);
      }
    }

    const createPayload = {
      _id: id,
      userId,
      idempotencyKey: idemKey || '',
      attempts: 0,
      maxAttempts,
      status: 'pending' as const,
      stage: 'queued',
      progressMessage: 'Queued',
      progressPercent: 0,
      cancelRequested: false,
      inputVideoUrl,
      inputVideoKey,
      inputVideoLocalPath: videoDest,
      inputAudioUrl,
      inputAudioKey,
      inputAudioLocalPath: audioDest,
      scriptText,
      bgmLocalPath: bgmDest,
      bgmKey,
      bgmUrl: jobBgmPresignedUrl,
      options,
      timeline: { clips: [] },
      s3Bucket: bucket || '',
      events: [{ at: new Date(), stage: 'queued', message: 'Job created' }],
    };

    let doc;
    try {
      doc = await StoryVideoJob.create(createPayload);
    } catch (e) {
      const code = (e as MongoDuplicateError).code;
      if (code === 11000 && idemKey) {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        const dup = await StoryVideoJob.findOne({ userId, idempotencyKey: idemKey }).lean();
        if (dup) {
          return {
            status: 200,
            body: {
              success: true,
              data: {
                jobId: dup._id.toString(),
                status: dup.status,
                idempotentReplay: true,
                options: dup.options,
              },
            },
          };
        }
      }
      throw e;
    }

    void queueStoryVideoJob(doc._id.toString());
    return {
      status: 201,
      body: {
        success: true,
        data: {
          jobId: doc._id.toString(),
          status: doc.status,
          options,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function presignStoryUploadService({
  userId,
  body,
}: PresignStoryUploadParams): Promise<StoryApiResult> {
  try {
    const bucket = resolveUserUploadsBucket();
    if (!bucket) {
      return {
        status: 503,
        body: {
          success: false,
          error: 'Set S3_USER_UPLOADS_BUCKET or S3_OUTPUT_BUCKET to enable S3 uploads',
          hint: 'Without S3, the app uses POST /api/story-video/upload-user-media (multipart); the editor switches automatically.',
        },
      };
    }
    const kindRaw = body.kind;
    const filenameRaw = body.filename;
    const contentTypeRaw = body.contentType;
    const k = (typeof kindRaw === 'string' ? kindRaw : '').toLowerCase();
    if (!['video', 'audio', 'bgm', 'image'].includes(k)) {
      return { status: 400, body: { success: false, error: 'kind must be video, audio, bgm, or image' } };
    }

    const ext = inferStoryUploadExt(k === 'bgm' ? 'audio' : k, typeof filenameRaw === 'string' ? filenameRaw : undefined);
    const ct =
      (typeof contentTypeRaw === 'string' ? contentTypeRaw : '').trim() ||
      defaultContentTypeForExt(ext, k === 'video' ? 'video' : k === 'image' ? 'image' : 'audio');
    const key = `user-uploads/${userId}/${randomUUID()}${ext}`;
    const expiresIn = 3600;
    const putUrl = await getPresignedPutUrl(bucket, key, ct, expiresIn);
    const getUrl = await getPresignedGetUrl(bucket, key, expiresIn);
    return {
      status: 200,
      body: {
        success: true,
        data: {
          putUrl,
          getUrl,
          bucket,
          key,
          contentType: ct,
          expiresIn,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export function isS3UploadConfigured(): boolean {
  return !!resolveUserUploadsBucket();
}

export async function uploadUserMediaService({
  userId,
  body,
  file,
}: UploadUserMediaParams): Promise<StoryApiResult> {
  try {
    if (!file?.path) {
      return { status: 400, body: { success: false, error: 'Missing file field' } };
    }

    const kind = String(body.kind || '').toLowerCase();
    if (!['video', 'audio', 'bgm', 'image'].includes(kind)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return { status: 400, body: { success: false, error: 'kind must be video, audio, bgm, or image' } };
    }

    const ext = path.extname(file.filename).toLowerCase();
    const ct =
      file.mimetype || defaultContentTypeForExt(ext, kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'audio');
    return {
      status: 200,
      body: {
        success: true,
        data: {
          path: `/api/story-video/user-media/${userId}/${file.filename}`,
          contentType: ct,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function resolveUserMediaFileService({
  env,
  authUserId,
  userId,
  filename,
}: ResolveUserMediaFileParams): Promise<StoryFileResult> {
  try {
    if (authUserId !== userId) {
      return { kind: 'json', status: 403, body: { success: false, error: 'Forbidden' } };
    }

    const safeFilename = path.basename(filename);
    if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(safeFilename)) {
      return { kind: 'json', status: 400, body: { success: false, error: 'Invalid filename' } };
    }

    const base = path.resolve(path.join(env.TEMP_DIR, 'story-user-media', userId));
    const filePath = path.resolve(path.join(base, safeFilename));
    if (!filePath.startsWith(base + path.sep)) {
      return { kind: 'json', status: 400, body: { success: false, error: 'Invalid path' } };
    }
    if (!fs.existsSync(filePath)) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Not found' } };
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const kind = mediaKindFromExt(ext);
    return {
      kind: 'file',
      path: filePath,
      headers: { 'Content-Type': defaultContentTypeForExt(ext, kind) },
    };
  } catch (e) {
    return {
      kind: 'json',
      status: 500,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

export async function listStoryJobsService({ userId, limitRaw }: ListStoryJobsParams): Promise<StoryApiResult> {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(limitRaw || '50'), 10) || 50));
    const jobs = await StoryVideoJob.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('_id status stage progressMessage progressPercent error createdAt updatedAt scriptText')
      .lean();
    const data = jobs.map((j) => {
      const st = (j.scriptText || '').trim().replace(/\s+/g, ' ');
      const scriptPreview = st.length > 160 ? `${st.slice(0, 160)}…` : st;
      return {
        jobId: j._id.toString(),
        status: j.status,
        stage: j.stage,
        progressMessage: j.progressMessage || '',
        progressPercent: j.progressPercent ?? 0,
        error: j.error || '',
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        scriptPreview,
      };
    });
    return { status: 200, body: { success: true, data } };
  } catch (e) {
    return internalError(e);
  }
}

export async function cancelStoryJobService({ userId, jobId }: StoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOneAndUpdate(
      { _id: jobId, userId, status: { $in: ['pending', 'processing'] } },
      {
        $set: {
          cancelRequested: true,
          progressMessage: 'Cancellation requested…',
        },
        $push: { events: { at: new Date(), stage: 'cancel', message: 'Cancellation requested' } },
      },
      { new: true }
    );
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found or not cancellable' } };
    }
    return { status: 200, body: { success: true } };
  } catch (e) {
    return internalError(e);
  }
}

export async function retryStoryJobService({ userId, jobId }: StoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOne({
      _id: jobId,
      userId,
      status: { $in: ['failed', 'cancelled'] },
    });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found or not eligible for retry' } };
    }
    job.attempts = 0;
    job.cancelRequested = false;
    job.status = 'pending';
    job.stage = 'queued';
    job.error = '';
    job.progressMessage = 'Queued for retry';
    job.progressPercent = 0;
    const ev = [...(job.events || []), { at: new Date(), stage: 'retry', message: 'Manual retry' }];
    job.events = ev.slice(-300);
    await job.save();
    void queueStoryVideoJob(job._id.toString());
    return { status: 200, body: { success: true } };
  } catch (e) {
    return internalError(e);
  }
}

export async function getStoryJobStatusService({ userId, jobId }: StoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }
    return {
      status: 200,
      body: {
        success: true,
        data: {
          jobId: job._id.toString(),
          status: job.status,
          stage: job.stage,
          progressMessage: job.progressMessage,
          progressPercent: job.progressPercent ?? 0,
          cancelRequested: !!job.cancelRequested,
          error: job.error || '',
          attempts: job.attempts ?? 0,
          maxAttempts:
            job.maxAttempts && job.maxAttempts > 0
              ? job.maxAttempts
              : Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10)),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function getStoryJobResultService({ userId, jobId }: StoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    let outputVideoUrl = job.outputVideoUrl || '';
    if (job.status === 'completed' && job.s3Bucket && job.outputVideoKey) {
      outputVideoUrl = await getPresignedGetUrl(job.s3Bucket, job.outputVideoKey, 86400);
    }

    let outputSrtUrl = '';
    if (job.status === 'completed' && job.s3Bucket && job.outputSrtKey) {
      outputSrtUrl = await getPresignedGetUrl(job.s3Bucket, job.outputSrtKey, 86400);
    }

    let scenes: unknown[] = [];
    const inter = job.intermediate;
    const scenesPath = inter?.scenesJson;
    if (scenesPath && fs.existsSync(scenesPath)) {
      try {
        scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8')) as unknown[];
      } catch {
        scenes = [];
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          jobId: job._id.toString(),
          status: job.status,
          timeline: job.timeline,
          outputVideoUrl,
          outputSrtUrl,
          scenes,
          options: job.options,
          error: job.error || '',
          detectedLanguages: {
            video: inter?.detectedVideoLanguage,
            narration: inter?.detectedNarrationLanguage,
          },
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function getStoryPlayUrlService({ userId, jobId }: StoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job || job.status !== 'completed') {
      return { status: 404, body: { success: false, error: 'Export not ready' } };
    }

    if (job.s3Bucket && job.outputVideoKey) {
      const url = await getPresignedGetUrl(job.s3Bucket, job.outputVideoKey, 86400);
      return { status: 200, body: { success: true, url } };
    }
    return { status: 200, body: { success: true, url: `/api/story-video/files/${jobId}/output.mp4` } };
  } catch (e) {
    return internalError(e);
  }
}

export async function getStorySubtitlesFileService({
  env,
  userId,
  jobId,
}: StoryFileJobParams): Promise<StoryFileResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Job not found' } };
    }

    const inter = job.intermediate;
    const srtPath = inter?.finalSrtPath || path.join(env.TEMP_DIR, 'story-video', userId, jobId, 'output.srt');
    if (!fs.existsSync(srtPath)) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Subtitles not available yet' } };
    }

    return {
      kind: 'file',
      path: path.resolve(srtPath),
      headers: {
        'Content-Type': 'application/x-subrip; charset=utf-8',
        'Content-Disposition': `attachment; filename="story-${jobId}.srt"`,
      },
    };
  } catch (e) {
    return {
      kind: 'json',
      status: 500,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

export async function editStoryJobService({ userId, jobId, body }: EditStoryJobParams): Promise<StoryApiResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId });
    if (!job) {
      return { status: 404, body: { success: false, error: 'Job not found' } };
    }

    const timelineRaw = body.timeline;
    const render = body.render;

    if (timelineRaw && typeof timelineRaw === 'object') {
      const timeline = timelineRaw as Partial<StoryTimeline>;
      const next = { ...(job.timeline || { clips: [] }) };
      if (Array.isArray(timeline.clips)) {
        next.clips = timeline.clips;
      }
      if (Array.isArray(timeline.imageLibrary)) {
        next.imageLibrary = timeline.imageLibrary;
      }
      job.timeline = next;
      await job.save();
    }

    if (render) {
      if (job.status === 'processing' && job.stage === 're_render') {
        return { status: 409, body: { success: false, error: 'Re-render already in progress' } };
      }
      if (job.status !== 'completed') {
        return {
          status: 400,
          body: {
            success: false,
            error: 'Job must be completed before re-render (wait for the initial pipeline to finish)',
          },
        };
      }

      job.status = 'processing';
      job.stage = 're_render';
      job.progressPercent = 0;
      job.progressMessage = 'Queued re-render…';
      job.error = '';
      job.cancelRequested = false;
      const ev = [...(job.events || []), { at: new Date(), stage: 're_render', message: 'Queued re-render' }];
      job.events = ev.slice(-300);
      await job.save();
      void runStoryRerenderJob(job._id.toString());
      return {
        status: 200,
        body: {
          success: true,
          data: {
            timeline: job.timeline,
            outputVideoUrl: '',
            outputSrtUrl: '',
            asyncRerender: true,
            status: 'processing',
          },
        },
      };
    }

    const fresh = await StoryVideoJob.findById(job._id);
    let outputVideoUrl = fresh?.outputVideoUrl ?? job.outputVideoUrl ?? '';
    if (fresh?.s3Bucket && fresh?.outputVideoKey) {
      outputVideoUrl = await getPresignedGetUrl(fresh.s3Bucket, fresh.outputVideoKey, 86400);
    }
    let outputSrtUrl = '';
    if (fresh?.s3Bucket && fresh?.outputSrtKey) {
      outputSrtUrl = await getPresignedGetUrl(fresh.s3Bucket, fresh.outputSrtKey, 86400);
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          timeline: fresh?.timeline ?? job.timeline,
          outputVideoUrl,
          outputSrtUrl,
        },
      },
    };
  } catch (e) {
    return internalError(e);
  }
}

export async function getOriginalVideoFileService({
  userId,
  jobId,
}: StoryJobParams): Promise<StoryFileResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Job not found' } };
    }

    const p = job.inputVideoLocalPath;
    if (!p || !fs.existsSync(p)) {
      return {
        kind: 'json',
        status: 404,
        body: {
          success: false,
          error: 'Original file not available on this server (S3-only upload)',
        },
      };
    }

    const ext = path.extname(p).toLowerCase();
    return {
      kind: 'file',
      path: path.resolve(p),
      headers: {
        'Content-Type': contentTypeForOriginalVideo(ext),
        'Cache-Control': 'no-store',
      },
    };
  } catch (e) {
    return {
      kind: 'json',
      status: 500,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

export async function getOutputVideoFileService({
  env,
  userId,
  jobId,
}: StoryFileJobParams): Promise<StoryFileResult> {
  try {
    const job = await StoryVideoJob.findOne({ _id: jobId, userId }).lean();
    if (!job) {
      return { kind: 'json', status: 404, body: { success: false, error: 'Job not found' } };
    }

    const inter = job.intermediate;
    const finalPath = inter?.finalPath || path.join(env.TEMP_DIR, 'story-video', userId, jobId, 'final_export.mp4');
    if (!fs.existsSync(finalPath)) {
      const fallback = path.join(env.TEMP_DIR, 'story-video', userId, jobId, 'story_output.mp4');
      if (!fs.existsSync(fallback)) {
        return {
          kind: 'json',
          status: 404,
          body: { success: false, error: 'Output not available on disk (use S3 URL)' },
        };
      }
      return {
        kind: 'file',
        path: path.resolve(fallback),
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store',
        },
      };
    }

    return {
      kind: 'file',
      path: path.resolve(finalPath),
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
      },
    };
  } catch (e) {
    return {
      kind: 'json',
      status: 500,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}
