import fs from 'fs';
import path from 'path';

import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { loadSettings } from '../../common/services/settingsService.js';
import { loadEnvConfig } from '../../common/config/envConfig.js';
import { cancelJobIfAlreadyRequested } from './cancelEarly.js';
import { quizzesFromPayload } from './quizzes.js';
import {
  appendJobEvent,
  setVideoProgress,
  videoRowExists,
} from './progress.js';
import { applyServerTtsFallback, resolveTtsFromRequest, type ResolvedTts } from './ttsResolution.js';
import { runIntroOutroPhase } from './introOutroPhase.js';
import { runMainRenderPhase } from './mainRenderPhase.js';
import { finalizeCompletedVideo } from './finalizeCompleted.js';
import { markJobFailed } from './markJobFailure.js';
import type { GenerateRequestPayload } from './types.js';
import { BACKEND_ROOT } from '../../common/config/paths.js';

const running = new Set<string>();

export async function runVideoJob(videoId: string): Promise<void> {
  if (running.has(videoId)) return;
  running.add(videoId);
  try {
    const doc = await Video.findById(videoId);
    if (!doc) return;
    if (doc.status === 'completed') return;
    if (!doc.requestJson) {
      await Video.findByIdAndUpdate(videoId, { status: 'failed', lastError: 'Missing request payload' });
      return;
    }

    await VideoJob.findOneAndUpdate(
      { videoId: doc._id },
      {
        $set: { status: 'running', stage: 'start', message: 'Generation started' },
        $push: { events: { at: new Date(), stage: 'start', message: 'Generation started' } },
      }
    ).catch(() => {});

    const req = JSON.parse(doc.requestJson) as GenerateRequestPayload;
    const userId = String(doc.userId);
    const settings = await loadSettings(userId);

    const quizzes = quizzesFromPayload(req);
    if (!quizzes.length) {
      await Video.findByIdAndUpdate(videoId, {
        status: 'failed',
        lastError: 'No quiz questions to render',
        progressStage: 'failed',
        progressMessage: 'No questions',
      });
      return;
    }

    const env = loadEnvConfig();
    const userVideoDir = path.join(env.OUTPUT_DIR, userId);
    if (!fs.existsSync(userVideoDir)) fs.mkdirSync(userVideoDir, { recursive: true });

    const rawFont = env.FONT_FILE?.trim() || 'assets/fonts/Montserrat-Bold.ttf';
    const fontFallback = path.isAbsolute(rawFont)
      ? rawFont
      : path.join(BACKEND_ROOT, rawFont.replace(/^\.\//, ''));
    const tempDir = path.join(env.TEMP_DIR, userId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    await Video.findByIdAndUpdate(videoId, {
      attempts: (doc.attempts || 0) + 1,
      lastError: '',
      status: 'generating',
    });
    await setVideoProgress(videoId, 'start', 'Generation started');
    await appendJobEvent(videoId, 'start', 'Generation started');

    let resolvedTts: ResolvedTts = resolveTtsFromRequest(req, settings);

    if (await cancelJobIfAlreadyRequested(videoId)) {
      return;
    }

    resolvedTts = applyServerTtsFallback(resolvedTts, settings);

    const introOutroCache = path.join(tempDir, 'tts_cache_intro_outro');
    if (!fs.existsSync(introOutroCache)) fs.mkdirSync(introOutroCache, { recursive: true });

    const introOutro = await runIntroOutroPhase({
      videoId,
      req,
      settings,
      quizzes,
      tempDir,
      fontFallback,
      resolvedTts,
      introOutroCacheDir: introOutroCache,
    });
    if (introOutro === null) {
      return;
    }
    const { introFile, outroFile } = introOutro;

    await setVideoProgress(videoId, 'voice', 'Voice generation started');
    await appendJobEvent(videoId, 'voice', 'Voice generation started');

    await runMainRenderPhase({
      quizzes,
      req,
      settings,
      env,
      userId,
      userVideoDir,
      tempDir,
      fontFallback,
      resolvedTts,
      introFile,
      outroFile,
    });

    if (!(await videoRowExists(videoId))) return;

    await setVideoProgress(videoId, 'render', 'Video rendering completed, finalizing');
    await appendJobEvent(videoId, 'render', 'Video rendering completed, finalizing');

    await finalizeCompletedVideo({ videoId, userId, userVideoDir });
  } catch (err: unknown) {
    await markJobFailed(videoId, err);
  } finally {
    running.delete(videoId);
  }
}
