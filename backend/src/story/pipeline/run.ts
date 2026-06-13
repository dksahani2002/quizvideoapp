/**
 * Story-video pipeline orchestrator (initial render + timeline re-export).
 *
 * End-to-end flow:
 *   1. Transcribe video + build scenes (parallel with narration resolution)
 *   2. Match narration ↔ scenes, cut silent clips, mux narration audio
 *   3. Subtitles, BGM, export, S3 upload
 *
 * Intermediate JSON/MP4 under `workDir` enables resume on retry. Re-render path reuses
 * cached clips when only visuals change.
 *
 * Entry points:
 *   - {@link runStoryVideoJob} — first-time processing (queued from routes)
 *   - {@link renderStoryJobFromCurrentTimeline} — editor timeline re-export
 *   - {@link runStoryRerenderJob} — background wrapper for re-render (HTTP fire-and-forget)
 */
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { StoryVideoJob, type IStoryVideoJob, type StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { loadSettings, resolveOpenAiCredentials } from '../../common/services/settingsService.js';
import {
  createOpenAIClient,
  transcribeAudioVerbose,
  assignWhisperToSceneWindows,
  parseStoredVideoWhisper,
  type TranscribeVerboseResult,
} from '../ai/openaiStory.js';
import { translateLinesToEnglish } from '../ai/translate.js';
import {
  matchNarrationToScenesByEmbeddings,
  matchNarrationToScenesSequential,
} from '../narration/narrationSceneMatch.js';
import {
  extractAudioWav16kMono,
  cutAndPadSilentSegment,
  concatVideoFilesConcatDemuxer,
  muxVideoWithAudio,
  extractAudioSegment,
  concatAudioFilesMp3,
  buildSceneWindows,
  getMediaDurationSec,
} from '../render/ffmpeg.js';
import { estimatedDurationSec, narrationFromWhisper } from '../narration/narration.js';
import { uploadFileToS3, getPresignedGetUrl, resolveOutputBucket } from '../../common/services/s3Storage.js';
import type { SceneSegment, NarrationSegment } from '../lib/types.js';
import { mergeStoryOptions } from '../lib/storyOptions.js';
import { resolveSceneCuts } from '../scene/detectFacade.js';
import { alignScriptToWhisperTimings } from '../narration/alignment.js';
import { synthesizeScriptToNarration } from '../narration/ttsNarration.js';
import { applySubtitlesAndBgm } from './finalize.js';
import {
  computeNarrationRerenderInputsFingerprint,
  resolveFinalNarrationForRerender,
  writeSilenceMp3,
} from './narrationRerender.js';
import { buildRerenderClipPaths } from './rerenderClips.js';
import type OpenAI from 'openai';

async function applyEnglishTranslationIfNeeded(
  job: IStoryVideoJob,
  opts: ReturnType<typeof mergeStoryOptions>,
  openai: OpenAI,
  scenes: SceneSegment[],
  narration: NarrationSegment[],
  scenesPath: string,
  narrationPath: string
): Promise<void> {
  if (!opts.translateToEnglish) return;
  const scenesNeed = scenes.some((s) => s.textOriginal == null);
  const narrNeed = narration.some((n) => n.textOriginal == null);
  if (!scenesNeed && !narrNeed) return;
  await setProgress(job, 38, 'translate', 'Translating scene and narration text to English…');
  if (scenesNeed) {
    const lines = scenes.map((s) => s.text);
    const en = await translateLinesToEnglish(openai, lines, 'video_scenes');
    for (let i = 0; i < scenes.length; i++) {
      const orig = scenes[i].text;
      scenes[i] = { ...scenes[i], textOriginal: orig, text: en[i] ?? orig };
    }
    await fs.writeFile(scenesPath, JSON.stringify(scenes), 'utf8');
  }
  if (narrNeed) {
    const lines = narration.map((n) => n.text);
    const en = await translateLinesToEnglish(openai, lines, 'narration');
    for (let i = 0; i < narration.length; i++) {
      const orig = narration[i].text;
      narration[i] = { ...narration[i], textOriginal: orig, text: en[i] ?? orig };
    }
    await fs.writeFile(narrationPath, JSON.stringify(narration), 'utf8');
  }
}

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

async function pushEvent(job: IStoryVideoJob, stage: string, message: string) {
  const ev = [...(job.events || []), { at: new Date(), stage, message }];
  job.events = ev.slice(-300) as typeof job.events;
}

async function setProgress(job: IStoryVideoJob, pct: number, stage: string, message: string) {
  job.progressPercent = Math.min(100, Math.max(0, pct));
  job.stage = stage;
  job.progressMessage = message;
  await pushEvent(job, stage, message);
  await job.save();
}

async function isCancelled(jobId: string): Promise<boolean> {
  const j = await StoryVideoJob.findById(jobId).select('cancelRequested').lean();
  return !!(j && (j as { cancelRequested?: boolean }).cancelRequested);
}

async function markCancelled(job: IStoryVideoJob) {
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.progressMessage = 'Cancelled';
  job.progressPercent = 0;
  job.idempotencyKey = '';
  await pushEvent(job, 'cancelled', 'Cancelled by user');
  await job.save();
}

function maxJobAttempts(job: IStoryVideoJob): number {
  const n = job.maxAttempts;
  if (n && n > 0) return n;
  return Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10));
}

async function failJobPermanent(job: IStoryVideoJob, error: string) {
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
  const job = await StoryVideoJob.findById(jobId);
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
    const { queueStoryVideoJob } = await import('./queue.js');
    setTimeout(() => {
      void queueStoryVideoJob(jobId);
    }, delay);
    return;
  }
  await failJobPermanent(job, error);
}

/**
 * Run the full story-video pipeline for a queued job.
 *
 * Loads/creates workDir artifacts, handles cancel/retry, uploads output to S3.
 * Do not await from HTTP — use {@link queueStoryVideoJob} instead.
 */
export async function runStoryVideoJob(jobId: string): Promise<void> {
  let job = await StoryVideoJob.findById(jobId);
  if (!job) {
    console.warn(`[story-video] Job not found: ${jobId}`);
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
    job.maxAttempts = Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10));
  }
  job.attempts = (job.attempts || 0) + 1;
  await job.save();

  const opts = mergeStoryOptions(job.options as any);
  job.options = opts as any;

  const openai = createOpenAIClient(apiKey, apiUrl);
  const workDir =
    job.intermediate?.workDir ||
    path.join(process.env.TEMP_DIR || './temp', 'story-video', userId, jobId);
  await ensureDir(workDir);

  try {
    job.status = 'processing';
    const inputVideo = job.inputVideoLocalPath;
    if (!inputVideo) {
      await failJobPermanent(job, 'Missing input video path');
      return;
    }

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    const videoWav = path.join(workDir, 'video_audio.wav');
    const videoWhisperPath = path.join(workDir, 'video_whisper.json');
    const scenesPath = path.join(workDir, 'scenes.json');
    const narrationPath = path.join(workDir, 'narration.json');
    const narrationMuxMetaPath = path.join(workDir, 'narration_mux.json');
    const matchesPath = path.join(
      workDir,
      opts.narrationSceneMatchMode === 'sequential' ? 'sequential_matches.json' : 'embedding_matches.json'
    );
    const timelineClipsPath = path.join(workDir, 'timeline_clips.json');
    const mergedSilent = path.join(workDir, 'merged_silent.mp4');
    const muxed = path.join(workDir, 'story_muxed.mp4');
    const clipsDir = path.join(workDir, 'clips');

    await setProgress(
      job,
      5,
      'transcribe',
      'Transcribing video and narration in parallel where possible…'
    );

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    const narrWav = path.join(workDir, 'narration.wav');

    const videoAndScenesPromise = (async (): Promise<{
      videoWhisper: TranscribeVerboseResult;
      scenes: SceneSegment[];
      videoWhisperFromFile: boolean;
      scenesFromFile: boolean;
      videoLanguage?: string;
    }> => {
      let videoWhisper: TranscribeVerboseResult;
      let videoWhisperFromFile: boolean;
      if (await pathExists(videoWhisperPath)) {
        const raw = JSON.parse(await fs.readFile(videoWhisperPath, 'utf8')) as unknown;
        videoWhisper = parseStoredVideoWhisper(raw);
        videoWhisperFromFile = true;
      } else {
        await extractAudioWav16kMono(inputVideo, videoWav);
        videoWhisper = await transcribeAudioVerbose(openai, videoWav);
        await fs.writeFile(videoWhisperPath, JSON.stringify(videoWhisper), 'utf8');
        videoWhisperFromFile = false;
      }

      let scenes: SceneSegment[];
      let scenesFromFile: boolean;
      if (await pathExists(scenesPath)) {
        scenes = JSON.parse(await fs.readFile(scenesPath, 'utf8')) as SceneSegment[];
        scenesFromFile = true;
      } else {
        const durationSec = await getMediaDurationSec(inputVideo);
        const cutTimes = await resolveSceneCuts(
          inputVideo,
          durationSec,
          opts.sceneDetectionMode,
          opts.ffmpegSceneThreshold
        );
        const windows = buildSceneWindows(durationSec, cutTimes);
        scenes = assignWhisperToSceneWindows(windows, videoWhisper.segments);
        await fs.writeFile(scenesPath, JSON.stringify(scenes), 'utf8');
        scenesFromFile = false;
      }
      return {
        videoWhisper,
        scenes,
        videoWhisperFromFile,
        scenesFromFile,
        videoLanguage: videoWhisper.language,
      };
    })();

    const NARRATION_INPUT_MISSING = '__NARRATION_INPUT_MISSING__';

    const narrationPromise = (async (): Promise<{
      narration: NarrationSegment[];
      narrationMuxPath: string | undefined;
      fromNarrationFile: boolean;
      narrationLanguage?: string;
    }> => {
      if (await pathExists(narrationPath)) {
        const narr = JSON.parse(await fs.readFile(narrationPath, 'utf8')) as NarrationSegment[];
        let mux: string | undefined = job.inputAudioLocalPath;
        if (await pathExists(narrationMuxMetaPath)) {
          const meta = JSON.parse(await fs.readFile(narrationMuxMetaPath, 'utf8')) as { muxPath?: string };
          const p = (meta.muxPath || '').trim();
          mux = p || job.inputAudioLocalPath;
        }
        return { narration: narr, narrationMuxPath: mux, fromNarrationFile: true };
      }

      if (job.scriptText?.trim() && job.inputAudioLocalPath) {
        await extractAudioWav16kMono(job.inputAudioLocalPath, narrWav);
        const nw = await transcribeAudioVerbose(openai, narrWav);
        return {
          narration: alignScriptToWhisperTimings(job.scriptText, nw.segments),
          narrationMuxPath: job.inputAudioLocalPath,
          fromNarrationFile: false,
          narrationLanguage: nw.language,
        };
      }
      if (job.scriptText?.trim()) {
        const syn = await synthesizeScriptToNarration({
          script: job.scriptText,
          settings,
          workDir,
          openai,
          language: opts.narrationLanguage || 'en',
          ttsProvider: opts.ttsProvider,
        });
        return {
          narration: syn.narration,
          narrationMuxPath: syn.narrationMp3Path,
          fromNarrationFile: false,
          narrationLanguage: syn.detectedLanguage,
        };
      }
      if (job.inputAudioLocalPath) {
        await extractAudioWav16kMono(job.inputAudioLocalPath, narrWav);
        const nw = await transcribeAudioVerbose(openai, narrWav);
        return {
          narration: narrationFromWhisper(nw.segments),
          narrationMuxPath: job.inputAudioLocalPath,
          fromNarrationFile: false,
          narrationLanguage: nw.language,
        };
      }
      throw new Error(NARRATION_INPUT_MISSING);
    })();

    let scenes: SceneSegment[];
    let narration: NarrationSegment[];
    let narrationMuxPath: string | undefined;
    let detectedVideoLanguage: string | undefined;
    let detectedNarrationLanguage: string | undefined;

    try {
      const [vp, np] = await Promise.all([videoAndScenesPromise, narrationPromise]);
      scenes = vp.scenes;
      narration = np.narration;
      narrationMuxPath = np.narrationMuxPath;
      detectedVideoLanguage = vp.videoLanguage;
      detectedNarrationLanguage = np.narrationLanguage;

      const allVideoSideCached = vp.videoWhisperFromFile && vp.scenesFromFile;
      if (allVideoSideCached && np.fromNarrationFile) {
        await setProgress(job, 32, 'transcribe', 'Resumed — cached video, scenes, and narration');
      } else if (allVideoSideCached) {
        await setProgress(job, 32, 'transcribe', 'Resumed video and scenes; narration finished in parallel');
      } else if (np.fromNarrationFile) {
        await setProgress(
          job,
          32,
          'transcribe',
          'Resumed narration; video transcript and scenes completed in parallel'
        );
      } else {
        await setProgress(
          job,
          32,
          'transcribe',
          'Video transcript, scenes, and narration completed (parallel where possible)'
        );
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === NARRATION_INPUT_MISSING) {
        await failJobPermanent(job, 'Provide narration audio or script text.');
        return;
      }
      throw e;
    }

    if (narration.length === 0) {
      await failJobPermanent(job, 'No narration segments produced.');
      return;
    }

    await applyEnglishTranslationIfNeeded(
      job,
      opts,
      openai,
      scenes,
      narration,
      scenesPath,
      narrationPath
    );

    if (!(await pathExists(narrationPath))) {
      await fs.writeFile(narrationPath, JSON.stringify(narration), 'utf8');
    }
    if (!(await pathExists(narrationMuxMetaPath))) {
      await fs.writeFile(narrationMuxMetaPath, JSON.stringify({ muxPath: narrationMuxPath || '' }), 'utf8');
    }

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    let matches: number[];
    let timelineClips: StoryTimelineClip[];
    const clipPaths: string[] = [];

    const skipClipsPhase =
      (await pathExists(mergedSilent)) &&
      (await pathExists(matchesPath)) &&
      (await pathExists(timelineClipsPath));

    if (!skipClipsPhase) {
      await setProgress(
        job,
        48,
        'embeddings',
        opts.narrationSceneMatchMode === 'sequential'
          ? 'Mapping narration to scenes in order (different language than video)…'
          : 'Matching narration to scenes by text similarity…'
      );

      if (await isCancelled(job._id.toString())) {
        await markCancelled(job);
        return;
      }

      matches =
        opts.narrationSceneMatchMode === 'sequential'
          ? matchNarrationToScenesSequential(narration.length, scenes.length)
          : await matchNarrationToScenesByEmbeddings(
              openai,
              narration.map((n) => n.text),
              scenes.map((s) => s.text || `Scene ${s.index + 1}`)
            );
      await fs.writeFile(matchesPath, JSON.stringify(matches), 'utf8');

      await setProgress(job, 62, 'clips', 'Building clips…');

      await ensureDir(clipsDir);
      timelineClips = [];

      for (let i = 0; i < narration.length; i++) {
        const n = narration[i];
        const sj = matches[i] ?? 0;
        const scene = scenes[sj];
        let narrDur: number;
        if (n.startSec != null && n.endSec != null) {
          narrDur = Math.max(0.2, n.endSec - n.startSec);
        } else {
          narrDur = estimatedDurationSec(n.text);
        }
        const sceneLen = Math.max(0.2, scene.end - scene.start);
        const videoTake = Math.min(narrDur, sceneLen);
        const rawClip = path.join(clipsDir, `clip_${String(i).padStart(4, '0')}.mp4`);
        await cutAndPadSilentSegment(inputVideo, scene.start, videoTake, narrDur, rawClip);
        clipPaths.push(rawClip);
        timelineClips.push({
          id: randomUUID(),
          start: scene.start,
          end: scene.start + videoTake,
          text: n.text,
          narrationIndex: i,
          sceneIndex: sj,
          programDurationSec: narrDur,
        });
      }

      await fs.writeFile(timelineClipsPath, JSON.stringify(timelineClips), 'utf8');
      await concatVideoFilesConcatDemuxer(clipPaths, mergedSilent);
    } else {
      matches = JSON.parse(await fs.readFile(matchesPath, 'utf8')) as number[];
      timelineClips = JSON.parse(await fs.readFile(timelineClipsPath, 'utf8')) as StoryTimelineClip[];
      await setProgress(job, 70, 'clips', 'Resumed — using cached merged silent video');
    }

    if (!(await pathExists(muxed))) {
      await setProgress(job, 74, 'audio_mix', 'Mixing narration audio…');

      const finalAudio = path.join(workDir, 'final_narration.mp3');
      const hasTimedNarration =
        !!narrationMuxPath &&
        narration.every((n) => n.startSec != null && n.endSec != null);
      const parts: string[] = [];
      for (let i = 0; i < narration.length; i++) {
        const n = narration[i];
        const p = path.join(workDir, `narr_part_${i}.mp3`);
        let narrDur: number;
        if (n.startSec != null && n.endSec != null) {
          narrDur = Math.max(0.2, n.endSec - n.startSec);
        } else {
          narrDur = estimatedDurationSec(n.text);
        }
        const targetDur = narrDur;
        if (hasTimedNarration && narrationMuxPath) {
          await extractAudioSegment(narrationMuxPath, n.startSec!, targetDur, p);
        } else {
          await writeSilenceMp3(targetDur, p);
        }
        parts.push(p);
      }
      await concatAudioFilesMp3(parts, finalAudio);

      await muxVideoWithAudio(mergedSilent, finalAudio, muxed);
    } else {
      await setProgress(job, 78, 'audio_mix', 'Resumed — using cached muxed video');
    }

    await setProgress(job, 82, 'finalize', 'Subtitles, music, and export…');

    if (await isCancelled(job._id.toString())) {
      await markCancelled(job);
      return;
    }

    job = (await StoryVideoJob.findById(jobId))!;
    const { finalPath, srtPath } = await applySubtitlesAndBgm({
      videoPath: muxed,
      workDir,
      clips: timelineClips,
      subtitleMode: opts.subtitleMode,
      bgmPath: job.bgmLocalPath || undefined,
      bgmVolume: opts.bgmVolume,
      exportPreset: opts.exportPreset,
    });

    await setProgress(job, 92, 'upload', 'Uploading…');

    const bucket = resolveOutputBucket();
    if (bucket) {
      const outputKey = `story-video/${userId}/${jobId}/output.mp4`;
      await uploadFileToS3(bucket, outputKey, finalPath, 'video/mp4');
      job.outputVideoKey = outputKey;
      job.outputVideoUrl = await getPresignedGetUrl(bucket, outputKey, 86400);
      job.s3Bucket = bucket;
      if (srtPath && opts.subtitleMode !== 'none') {
        const srtKey = `story-video/${userId}/${jobId}/output.srt`;
        await uploadFileToS3(bucket, srtKey, srtPath, 'text/plain');
        job.outputSrtKey = srtKey;
      }
    } else {
      job.outputVideoUrl = `/api/story-video/files/${jobId}/output.mp4`;
    }

    job.timeline = { clips: timelineClips };
    job.status = 'completed';
    job.stage = 'completed';
    job.progressMessage = 'Done';
    job.progressPercent = 100;
    job.error = '';
    const narrationRerenderFingerprint = await computeNarrationRerenderInputsFingerprint(
      job,
      workDir,
      timelineClips,
      path.join(workDir, 'narration.json')
    );
    job.intermediate = {
      ...job.intermediate,
      workDir,
      narrationSegmentsJson: path.join(workDir, 'narration.json'),
      sceneCutsJson: path.join(workDir, 'scenes.json'),
      scenesJson: scenesPath,
      clipsDir,
      mergedPath: mergedSilent,
      finalPath,
      finalSrtPath: srtPath,
      detectedVideoLanguage,
      detectedNarrationLanguage,
      narrationRerenderFingerprint,
    };
    await pushEvent(job, 'completed', 'Completed');
    await job.save();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await scheduleRetryOrFail(jobId, msg);
  }
}

/**
 * Re-export the current timeline (after editor changes) to a new output MP4.
 *
 * Re-cuts clips from the original upload, rebuilds narration if needed, finalizes with
 * subtitles/BGM. Job must be `completed` or already in `re_render` stage.
 */
export async function renderStoryJobFromCurrentTimeline(jobId: string): Promise<void> {
  const job = await StoryVideoJob.findById(jobId);
  if (!job) {
    throw new Error('Job not found');
  }
  const canRerender =
    job.status === 'completed' ||
    (job.status === 'processing' && job.stage === 're_render');
  if (!canRerender) {
    throw new Error('Job not ready for re-render');
  }
  const userId = job.userId.toString();
  const opts = mergeStoryOptions(job.options as any);
  const workDir = job.intermediate?.workDir || path.join(process.env.TEMP_DIR || './temp', 'story-video', userId, jobId);
  const inputVideo = job.inputVideoLocalPath;
  if (!inputVideo) throw new Error('Missing source video');

  const clips = job.timeline?.clips || [];
  if (clips.length === 0) {
    throw new Error('Timeline has no clips to render');
  }

  const n = clips.length;
  await setProgress(job, 2, 're_render', `Re-rendering ${n} clip(s) — this runs in the background…`);

  const onRerenderProgress = (pct: number, message: string) =>
    setProgress(job, pct, 're_render', message);

  const clipPaths = await buildRerenderClipPaths({
    workDir,
    inputVideo,
    clips,
    onProgress: onRerenderProgress,
  });

  await setProgress(job, 80, 're_render', 'Concatenating clips…');
  const mergedSilent = path.join(workDir, 'merged_reedit.mp4');
  await concatVideoFilesConcatDemuxer(clipPaths, mergedSilent);

  const { path: finalAudio, fingerprint: narrFp } = await resolveFinalNarrationForRerender(
    job,
    workDir,
    clips,
    onRerenderProgress
  );
  const muxed = path.join(workDir, 'story_reedit_mux.mp4');
  await setProgress(job, 88, 're_render', 'Muxing narration audio…');
  await muxVideoWithAudio(mergedSilent, finalAudio, muxed);

  await setProgress(job, 90, 're_render', 'Subtitles & export…');
  const { finalPath, srtPath } = await applySubtitlesAndBgm({
    videoPath: muxed,
    workDir,
    clips: job.timeline.clips,
    subtitleMode: opts.subtitleMode,
    bgmPath: job.bgmLocalPath || undefined,
    bgmVolume: opts.bgmVolume,
    exportPreset: opts.exportPreset,
  });

  const bucket = resolveOutputBucket();
  if (bucket) {
    const outputKey = `story-video/${userId}/${jobId}/output.mp4`;
    await uploadFileToS3(bucket, outputKey, finalPath, 'video/mp4');
    job.outputVideoKey = outputKey;
    job.outputVideoUrl = await getPresignedGetUrl(bucket, outputKey, 86400);
    job.s3Bucket = bucket;
    if (srtPath && opts.subtitleMode !== 'none') {
      const srtKey = `story-video/${userId}/${jobId}/output.srt`;
      await uploadFileToS3(bucket, srtKey, srtPath, 'text/plain');
      job.outputSrtKey = srtKey;
    }
  } else {
    job.outputVideoUrl = `/api/story-video/files/${jobId}/output.mp4`;
  }
  job.intermediate = {
    ...job.intermediate,
    finalPath,
    finalSrtPath: srtPath,
    narrationRerenderFingerprint: narrFp || job.intermediate?.narrationRerenderFingerprint,
  };
  job.status = 'completed';
  job.stage = 'completed';
  job.progressPercent = 100;
  job.progressMessage = 'Output ready';
  job.error = '';
  await pushEvent(job, 'completed', 'Re-render complete');
  await job.save();
}

/**
 * Background worker for timeline re-export.
 *
 * Catches errors and marks the job failed. Triggered from POST `/:jobId/edit` with `render: true`.
 * Can run many minutes — do not await from HTTP handlers.
 */
export async function runStoryRerenderJob(jobId: string): Promise<void> {
  try {
    await renderStoryJobFromCurrentTimeline(jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const job = await StoryVideoJob.findById(jobId);
    if (job) await failJobPermanent(job, msg);
  }
}
