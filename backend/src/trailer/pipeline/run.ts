/**
 * Trailer breakdown pipeline orchestrator.
 */
import fs from 'fs/promises';
import path from 'path';
import {
  TrailerBreakdownJob,
  type ITrailerBreakdownJob,
  type BreakdownSegment,
} from '../../common/db/models/TrailerBreakdownJob.js';
import { loadSettings, resolveOpenAiCredentials } from '../../common/services/settingsService.js';
import { createOpenAIClient, transcribeAudioVerbose } from '../../capabilities/ai/index.js';
import { assignWhisperToSceneWindows } from '../../story/ai/openaiStory.js';
import {
  extractAudioWav16kMono,
  buildSceneWindows,
  getMediaDurationSec,
} from '../../story/render/ffmpeg.js';
import { resolveSceneCuts } from '../../story/scene/detectFacade.js';
import { uploadFileToS3, getPresignedGetUrl, resolveOutputBucket } from '../../common/services/s3Storage.js';
import { downloadYoutubeVideo } from '../io/youtubeDownload.js';
import { generateTrailerBreakdownScript } from '../ai/trailerAnalysis.js';
import { assembleBreakdownVideo } from '../render/assembleBreakdown.js';

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function pushEvent(job: ITrailerBreakdownJob, stage: string, message: string) {
  const ev = [...(job.events || []), { at: new Date(), stage, message }];
  job.events = ev.slice(-300) as typeof job.events;
}

async function setProgress(job: ITrailerBreakdownJob, pct: number, stage: string, message: string) {
  job.progressPercent = Math.min(100, Math.max(0, pct));
  job.stage = stage;
  job.progressMessage = message;
  await pushEvent(job, stage, message);
  await job.save();
}

async function isCancelled(jobId: string): Promise<boolean> {
  const j = await TrailerBreakdownJob.findById(jobId).select('cancelRequested').lean();
  return !!(j && (j as { cancelRequested?: boolean }).cancelRequested);
}

async function markCancelled(job: ITrailerBreakdownJob) {
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.progressMessage = 'Cancelled';
  job.progressPercent = 0;
  job.idempotencyKey = '';
  await pushEvent(job, 'cancelled', 'Cancelled by user');
  await job.save();
}

function maxJobAttempts(job: ITrailerBreakdownJob): number {
  const n = job.maxAttempts;
  if (n && n > 0) return n;
  return Math.max(1, parseInt(process.env.TRAILER_BREAKDOWN_MAX_JOB_ATTEMPTS || '3', 10));
}

async function failJobPermanent(job: ITrailerBreakdownJob, error: string) {
  job.status = 'failed';
  job.stage = 'failed';
  job.error = error;
  job.progressMessage = error;
  job.progressPercent = 0;
  job.idempotencyKey = '';
  await pushEvent(job, 'failed', error);
  await job.save();
}

async function scheduleRetryOrFail(jobId: string, error: string): Promise<void> {
  const job = await TrailerBreakdownJob.findById(jobId);
  if (!job) return;
  const max = maxJobAttempts(job);
  if (await isCancelled(job._id.toString())) {
    await failJobPermanent(job, error);
    return;
  }
  if (job.attempts < max) {
    job.status = 'pending';
    job.stage = 'queued';
    job.progressMessage = `Will retry (${job.attempts}/${max}): ${error.slice(0, 200)}`;
    job.error = error;
    job.progressPercent = 0;
    await pushEvent(job, 'retry_scheduled', error);
    await job.save();
    const delay = Math.min(120_000, 3000 * Math.pow(2, Math.max(0, job.attempts - 1)));
    const { queueTrailerBreakdownJob } = await import('./queue.js');
    const userId = job.userId.toString();
    const workDir =
      job.intermediate?.workDir ||
      path.join(process.env.TEMP_DIR || './temp', 'trailer-breakdown', userId, jobId);
    const sourcePath = job.intermediate?.sourceVideoPath || path.join(workDir, 'source.mp4');
    const hasScript = (job.breakdownScript?.length ?? 0) > 0;
    let hasSource = false;
    try {
      await fs.access(sourcePath);
      hasSource = true;
    } catch {
      hasSource = false;
    }
    const resumeOpts =
      hasScript && hasSource ? { renderOnly: true as const } : {};
    setTimeout(() => {
      void queueTrailerBreakdownJob(jobId, resumeOpts);
    }, delay);
    return;
  }
  await failJobPermanent(job, error);
}

/** Load breakdown script from MongoDB or cached JSON on disk. */
async function ensureBreakdownScriptLoaded(
  job: ITrailerBreakdownJob,
  scriptPath: string
): Promise<BreakdownSegment[]> {
  if (job.breakdownScript?.length) {
    return job.breakdownScript;
  }
  if (await pathExists(scriptPath)) {
    const raw = JSON.parse(await fs.readFile(scriptPath, 'utf8')) as {
      title?: string;
      segments?: BreakdownSegment[];
    };
    if (raw.segments?.length) {
      job.breakdownScript = raw.segments;
      if (raw.title) job.breakdownTitle = raw.title;
      await job.save();
      return raw.segments;
    }
  }
  return [];
}

export type RunTrailerOptions = {
  /** Skip download/transcribe/script; re-render from existing breakdownScript. */
  renderOnly?: boolean;
  /** Rebuild all segment clips (default false — reuse cached segments when possible). */
  forceRerender?: boolean;
};

/**
 * Run the full trailer breakdown pipeline for a queued job.
 */
export async function runTrailerBreakdownJob(jobId: string, opts: RunTrailerOptions = {}): Promise<void> {
  let job = await TrailerBreakdownJob.findById(jobId);
  if (!job) {
    console.warn(`[trailer-breakdown] Job not found: ${jobId}`);
    return;
  }

  if (job.status === 'cancelled' && job.stage === 'cancelled') {
    return;
  }

  const userId = job.userId.toString();
  const settings = await loadSettings(userId);
  const { apiKey, apiUrl } = resolveOpenAiCredentials(settings);
  if (!apiKey) {
    await failJobPermanent(
      job,
      'OpenAI API key required. Add it in Settings, or set OPENAI_API_KEY in the server environment.'
    );
    return;
  }

  if (!job.maxAttempts || job.maxAttempts < 1) {
    job.maxAttempts = maxJobAttempts(job);
  }
  job.attempts = (job.attempts || 0) + 1;

  const workDir =
    job.intermediate?.workDir ||
    path.join(process.env.TEMP_DIR || './temp', 'trailer-breakdown', userId, jobId);
  await ensureDir(workDir);
  job.intermediate = { ...job.intermediate, workDir };
  await job.save();

  const openai = createOpenAIClient(apiKey, apiUrl);
  const options = job.options;
  const transcriptPath = path.join(workDir, 'transcript.json');
  const scenesPath = path.join(workDir, 'scenes.json');
  const scriptPath = path.join(workDir, 'breakdown_script.json');

  try {
    job.status = 'processing';
    await job.save();

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    const sourceVideoPath = job.intermediate?.sourceVideoPath || path.join(workDir, 'source.mp4');
    const hasSource = await pathExists(sourceVideoPath);
    let segments = await ensureBreakdownScriptLoaded(job, scriptPath);
    const hasScript = segments.length > 0;

    const skipAnalysis = opts.renderOnly || (hasSource && hasScript);

    if (!skipAnalysis) {
      if (!hasSource) {
        await setProgress(job, 5, 'download', 'Downloading trailer from YouTube…');
        const dl = await downloadYoutubeVideo(job.youtubeUrl, workDir);
        job.intermediate = {
          ...job.intermediate,
          workDir,
          sourceVideoPath: dl.videoPath,
          videoTitle: dl.title,
        };
        if (!job.movieTitle && dl.title) {
          job.movieTitle = dl.title.replace(/\s*[-|–]\s*Official Trailer.*$/i, '').trim();
        }
        await job.save();
      } else {
        await setProgress(job, 8, 'download', 'Using cached downloaded trailer');
        job.intermediate = { ...job.intermediate, workDir, sourceVideoPath };
        await job.save();
      }

      if (await isCancelled(job._id.toString())) {
        await markCancelled(job);
        return;
      }

      const videoWav = path.join(workDir, 'video_audio.wav');
      let transcript: Array<{ start: number; end: number; text: string }> = [];

      if (await pathExists(transcriptPath)) {
        transcript = JSON.parse(await fs.readFile(transcriptPath, 'utf8')) as typeof transcript;
        await setProgress(job, 12, 'transcribe', 'Using cached transcript');
      } else {
        await setProgress(job, 15, 'transcribe', 'Transcribing trailer audio…');
        await extractAudioWav16kMono(sourceVideoPath, videoWav);
        const whisper = await transcribeAudioVerbose(openai, videoWav);
        transcript = whisper.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
        await fs.writeFile(transcriptPath, JSON.stringify(transcript), 'utf8');
      }

      let scenes: Array<{ start: number; end: number; text: string }> = [];
      if (await pathExists(scenesPath)) {
        scenes = JSON.parse(await fs.readFile(scenesPath, 'utf8')) as typeof scenes;
        await setProgress(job, 25, 'detect_scenes', 'Using cached scene cuts');
      } else {
        await setProgress(job, 28, 'detect_scenes', 'Detecting scene cuts…');
        const durationSec = await getMediaDurationSec(sourceVideoPath);
        const cutTimes = await resolveSceneCuts(
          sourceVideoPath,
          durationSec,
          options.sceneDetectionMode,
          options.ffmpegSceneThreshold
        );
        const windows = buildSceneWindows(durationSec, cutTimes);
        const sceneSegments = assignWhisperToSceneWindows(
          windows,
          transcript.map((t) => ({ start: t.start, end: t.end, text: t.text }))
        );
        scenes = sceneSegments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text || '',
        }));
        await fs.writeFile(scenesPath, JSON.stringify(scenes), 'utf8');
      }

      if (await isCancelled(job._id.toString())) {
        await markCancelled(job);
        return;
      }

      segments = await ensureBreakdownScriptLoaded(job, scriptPath);
      if (segments.length === 0) {
        await setProgress(job, 38, 'generate_script', 'Generating breakdown script with AI…');
        const durationSec = await getMediaDurationSec(sourceVideoPath);
        const movieTitle = job.movieTitle || job.intermediate?.videoTitle || 'Unknown Movie';
        const script = await generateTrailerBreakdownScript({
          client: openai,
          movieTitle,
          durationSec,
          transcript,
          scenes,
        });
        segments = script.segments;
        job.breakdownScript = segments;
        job.breakdownTitle = script.title;
        job.intermediate = {
          ...job.intermediate,
          workDir,
          sourceVideoPath,
          transcriptJson: transcriptPath,
          sceneCutsJson: scenesPath,
          breakdownScriptJson: scriptPath,
        };
        await fs.writeFile(scriptPath, JSON.stringify({ title: script.title, segments }), 'utf8');
        await job.save();
      } else {
        await setProgress(job, 42, 'generate_script', 'Using existing breakdown script');
      }
    } else {
      if (!hasScript) {
        await failJobPermanent(job, 'No breakdown script to render');
        return;
      }
      if (!hasSource) {
        await failJobPermanent(job, 'Source video missing; cannot re-render');
        return;
      }
      await setProgress(
        job,
        45,
        'resume',
        opts.renderOnly
          ? 'Re-rendering video from saved script (skipping download & analysis)…'
          : 'Resuming — using cached trailer and script…'
      );
      job.breakdownScript = segments;
      await job.save();
    }

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    segments = job.breakdownScript;
    if (!segments.length) {
      await failJobPermanent(job, 'Breakdown script is empty');
      return;
    }

    await setProgress(job, 50, 'render', 'Synthesizing voiceover and rendering clips…');

    const { finalPath, narrationPath } = await assembleBreakdownVideo({
      sourceVideoPath,
      segments,
      workDir,
      settings,
      options,
      forceRerender: opts.forceRerender,
      onProgress: (pct, msg) => setProgress(job!, pct, 'render', msg),
    });

    await setProgress(job, 92, 'upload', 'Uploading breakdown video…');

    const bucket = resolveOutputBucket();
    if (bucket) {
      const outputKey = `trailer-breakdown/${userId}/${jobId}/output.mp4`;
      await uploadFileToS3(bucket, outputKey, finalPath, 'video/mp4');
      job.outputVideoKey = outputKey;
      job.outputVideoUrl = await getPresignedGetUrl(bucket, outputKey, 86400);
      job.s3Bucket = bucket;
    } else {
      job.outputVideoUrl = `/api/trailer-breakdown/files/${jobId}/output.mp4`;
    }

    job.intermediate = {
      ...job.intermediate,
      workDir,
      sourceVideoPath,
      narrationAudioPath: narrationPath,
      finalPath,
      clipsDir: path.join(workDir, 'breakdown-clips'),
    };
    job.status = 'completed';
    job.stage = 'completed';
    job.progressMessage = 'Done';
    job.progressPercent = 100;
    job.error = '';
    await pushEvent(job, 'completed', 'Breakdown video ready');
    await job.save();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await scheduleRetryOrFail(jobId, msg);
  }
}

/** Re-render after script edits or to fix output (skips download/analysis). */
export async function runTrailerRerenderJob(jobId: string): Promise<void> {
  try {
    await runTrailerBreakdownJob(jobId, { renderOnly: true, forceRerender: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const job = await TrailerBreakdownJob.findById(jobId);
    if (job) await failJobPermanent(job, msg);
  }
}
