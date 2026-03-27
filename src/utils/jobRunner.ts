import fs from 'fs';
import path from 'path';
import { queueVideoJob } from './queueVideoJob.js';
import { Video } from '../db/models/Video.js';
import { loadSettings } from '../services/settingsService.js';
import { loadEnvConfig } from '../config/envConfig.js';
import { createTTSService } from '../services/ttsService.js';
import { sanitizeForTTS } from '../utils/textSanitizer.js';
import { renderVideo } from '../videoRenderer.js';
import { uploadFileToS3 } from '../services/s3Storage.js';
import { renderIntroSlide, renderOutroSlide } from './ffmpeg.js';
import type { Quiz } from '../types/index.js';
import type { MCQ } from '../agents/mcqAgent.js';
import { VideoJob } from '../db/models/VideoJob.js';

type GenerateRequestPayload = {
  topic: string;
  questionCount: number;
  mcqSource: 'openai' | 'manual';
  manualQuizzes?: MCQ[];
  /** Resolved quizzes (required for rendering; set for both AI and manual flows). */
  quizzes?: Quiz[];
  ttsProvider: 'system' | 'openai' | 'elevenlabs';
  theme?: any;
  textAlign?: any;
  language?: string;
  difficulty?: string;
  tone?: string;
  audience?: string;
  customInstructions?: string;
  openaiModel?: string;
  layoutDensity?: number;
  headerTitle?: string;
  ttsVoice?: string;
  ttsModel?: string;
  systemVoice?: string;
  elevenlabsModelId?: string;
  introScript?: string;
  outroScript?: string;
  ctaLine?: string;
  captionsBurnIn?: boolean;
};

const running = new Set<string>();

async function setProgress(videoId: string, stage: string, message: string): Promise<void> {
  await Video.findByIdAndUpdate(videoId, {
    progressStage: stage,
    progressMessage: message,
  }).catch(() => {});
}

async function appendJobEvent(videoId: string, stage: string, message: string): Promise<void> {
  await VideoJob.findOneAndUpdate(
    { videoId },
    {
      $set: { stage, message },
      $push: { events: { at: new Date(), stage, message } },
    }
  ).catch(() => {});
}

async function isCancelRequested(videoId: string): Promise<boolean> {
  const job = await VideoJob.findOne({ videoId }).select('cancelRequested status').lean();
  return !!(job && (job.cancelRequested || job.status === 'cancelled'));
}

/** False if the video row was deleted (e.g. user cancelled while generating). */
async function videoRowExists(videoId: string): Promise<boolean> {
  const v = await Video.findById(videoId).select('_id').lean();
  return !!v;
}

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

    // On AWS Lambda (linux), "system" TTS (macOS `say`) is unavailable.
    // Auto-fallback to OpenAI if a key exists, else ElevenLabs if configured, else fail with a clear message.
    let tts = req.ttsProvider || settings.tts.provider || 'system';
    const voiceFromReq = req.ttsVoice?.trim();
    const systemVoice = req.systemVoice?.trim();
    let ttsVoice =
      tts === 'elevenlabs'
        ? voiceFromReq || settings.elevenlabs.voiceId
        : tts === 'openai'
          ? voiceFromReq || settings.tts.voice
          : systemVoice || settings.tts.voice;

    let quizzes: Quiz[];
    if (req.quizzes && req.quizzes.length > 0) {
      quizzes = req.quizzes.map((q: any) => ({
        question: q.question,
        options: q.options as [string, string, string, string],
        answerIndex: q.answerIndex as 0 | 1 | 2 | 3,
        language: q.language || 'en',
      }));
    } else {
      quizzes = (req.manualQuizzes || []).map((mcq: any) => ({
        question: mcq.question,
        options: (Array.isArray(mcq.options) ? mcq.options : Object.values(mcq.options || {})) as [string, string, string, string],
        answerIndex: mcq.answerIndex as 0 | 1 | 2 | 3,
        language: 'en',
      }));
    }

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

    const fontFile = env.FONT_FILE || './assets/fonts/Montserrat-Bold.ttf';
    const tempDir = path.join(env.TEMP_DIR, userId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    await Video.findByIdAndUpdate(videoId, { attempts: (doc.attempts || 0) + 1, lastError: '', status: 'generating' });
    await setProgress(videoId, 'start', 'Generation started');
    await appendJobEvent(videoId, 'start', 'Generation started');
    const ttsModel = req.ttsModel?.trim() || 'tts-1';
    const elevenModel = req.elevenlabsModelId?.trim() || settings.elevenlabs.modelId || 'eleven_turbo_v2_5';
    const openaiKey = settings.openai.apiKey?.trim() || '';

    if (await isCancelRequested(videoId)) {
      await Video.findByIdAndUpdate(videoId, {
        status: 'failed',
        lastError: 'Cancelled',
        progressStage: 'cancelled',
        progressMessage: 'Cancelled',
      }).catch(() => {});
      await VideoJob.findOneAndUpdate(
        { videoId },
        { $set: { status: 'cancelled', stage: 'cancelled', message: 'Cancelled' }, $push: { events: { at: new Date(), stage: 'cancelled', message: 'Cancelled' } } }
      ).catch(() => {});
      return;
    }

    if (tts === 'system' && process.platform !== 'darwin') {
      if (openaiKey) {
        tts = 'openai';
      } else if (settings.elevenlabs.apiKey?.trim()) {
        tts = 'elevenlabs';
      } else {
        throw new Error(
          'System TTS is not available on this server. Configure OpenAI or ElevenLabs TTS in Settings before rendering.'
        );
      }
    }

    const introOutroCache = path.join(tempDir, 'tts_cache_intro_outro');
    if (!fs.existsSync(introOutroCache)) fs.mkdirSync(introOutroCache, { recursive: true });

    const ttsForIntroOutro = createTTSService(tts, {
      apiKey: openaiKey,
      model: ttsModel,
      cacheDir: introOutroCache,
      elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
      elevenlabsModelId: elevenModel,
      openaiApiUrl: settings.openai.apiUrl || 'https://api.openai.com/v1',
    });

    const lang = quizzes[0]?.language || 'en';
    const topicSafe = sanitizeForTTS(req.topic || 'Quiz');
    const introTpl = (req.introScript || settings.brand?.introScript || '').trim() || 'Can you answer this? This quiz is about {{topic}}.';
    const outroTpl = (req.outroScript || settings.brand?.outroScript || '').trim() || 'Follow for more quizzes. Like and subscribe.';
    const cta = (req.ctaLine || settings.brand?.ctaLine || '').trim();
    const introSpeech = introTpl.replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);
    const outroSpeech = (cta ? `${outroTpl} ${cta}` : outroTpl).replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);

    let introVoiceFile = './assets/audio/intro_voice.mp3';
    let outroVoiceFile = './assets/audio/outro_voice.mp3';
    try {
      introVoiceFile = await ttsForIntroOutro.generate(introSpeech, lang, ttsVoice);
      outroVoiceFile = await ttsForIntroOutro.generate(outroSpeech, lang, ttsVoice);
    } catch (e: any) {
      console.warn('Intro/outro TTS failed, using bundled fallback audio:', e?.message || e);
    }

    const introFile = path.join(tempDir, 'intro.mp4');
    const outroFile = path.join(tempDir, 'outro.mp4');
    await setProgress(videoId, 'intro', 'Rendering intro');
    await appendJobEvent(videoId, 'intro', 'Rendering intro');
    await renderIntroSlide(introFile, req.topic || 'Quiz', {
      width: 1080, height: 1920, fps: 30, fontFile,
      voiceFile: introVoiceFile,
      bgmFile: './assets/audio/bgm.mp3',
      dingFile: './assets/audio/ding.mp3',
    });
    if (!(await videoRowExists(videoId))) return;
    if (await isCancelRequested(videoId)) throw new Error('Cancelled');
    await setProgress(videoId, 'outro', 'Rendering outro');
    await appendJobEvent(videoId, 'outro', 'Rendering outro');
    await renderOutroSlide(outroFile, {
      width: 1080, height: 1920, fps: 30, fontFile,
      voiceFile: outroVoiceFile,
      bgmFile: './assets/audio/bgm.mp3',
    });
    if (!(await videoRowExists(videoId))) return;
    if (await isCancelRequested(videoId)) throw new Error('Cancelled');

    await setProgress(videoId, 'voice', 'Voice generation started');
    await appendJobEvent(videoId, 'voice', 'Voice generation started');

    await renderVideo(quizzes, {
      fontFile,
      tempDir,
      outputDir: userVideoDir,
      cacheDir: path.join(env.CACHE_DIR, userId),
      ttsProvider: tts,
      ttsVoice: ttsVoice || undefined,
      ...(tts === 'openai' ? { ttsModel } : {}),
      introVideo: introFile,
      outroVideo: outroFile,
      theme: req.theme || undefined,
      textAlign: req.textAlign || undefined,
      layoutDensity: typeof req.layoutDensity === 'number' ? req.layoutDensity : undefined,
      headerTitle: req.headerTitle?.trim() || undefined,
      captions: { enabled: true, burnIn: !!req.captionsBurnIn },
      watermark: settings.brand?.watermarkImage
        ? {
            imagePath: settings.brand.watermarkImage,
            opacity: settings.brand.watermarkOpacity,
            position: settings.brand.watermarkPosition,
          }
        : undefined,
      elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
      elevenlabsModelId: elevenModel,
      openaiApiKey: openaiKey || undefined,
      openaiApiUrl: settings.openai.apiUrl || undefined,
    } as any);
    if (!(await videoRowExists(videoId))) return;
    await setProgress(videoId, 'render', 'Video rendering completed, finalizing');
    await appendJobEvent(videoId, 'render', 'Video rendering completed, finalizing');

    const resolvedDir = path.resolve(userVideoDir);
    const outputFiles = fs.readdirSync(resolvedDir)
      .filter(f => f.startsWith('quiz_video_') && f.endsWith('.mp4'))
      .sort((a, b) => {
        const sa = fs.statSync(path.join(resolvedDir, a));
        const sb = fs.statSync(path.join(resolvedDir, b));
        return sb.mtimeMs - sa.mtimeMs;
      });

    if (outputFiles.length === 0) {
      if (!(await videoRowExists(videoId))) return;
      await Video.findByIdAndUpdate(videoId, { status: 'failed', lastError: 'No output video produced', progressStage: 'failed', progressMessage: 'Failed: no output produced' });
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
      { $set: { status: 'completed', stage: 'completed', message: 'Completed' }, $push: { events: { at: new Date(), stage: 'completed', message: 'Completed' } } }
    ).catch(() => {});
  } catch (err: any) {
    if (!(await videoRowExists(videoId))) return;
    const msg = err?.message || String(err);
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
        $set: { status: cancelled ? 'cancelled' : 'failed', stage: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelled' : (msg || 'Failed') },
        $push: { events: { at: new Date(), stage: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Cancelled' : (msg || 'Failed') } },
      }
    ).catch(() => {});
  } finally {
    running.delete(videoId);
  }
}

export async function retryStuckJobs(): Promise<void> {
  const stuck = await Video.find({ status: 'generating' }).limit(20);
  for (const v of stuck) {
    void queueVideoJob(v._id.toString());
  }
}

