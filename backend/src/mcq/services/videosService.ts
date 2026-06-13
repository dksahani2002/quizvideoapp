import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import type { EnvConfig } from '../../common/config/envConfig.js';
import { loadSettings, resolveOpenAiCredentials } from '../../common/services/settingsService.js';
import { Video } from '../../common/db/models/Video.js';
import { VideoJob } from '../../common/db/models/VideoJob.js';
import { generateMCQs, type MCQ, type MCQGenerationOptions } from '../agents/mcqAgent.js';
import type { Quiz } from '../../common/types/index.js';
import { queueVideoJob } from '../utils/queueVideoJob.js';
import { normalizeQuizLanguage } from '../utils/quizLanguages.js';
import { prepareTopicForQuizGeneration } from '../utils/topicLocalization.js';
import {
  getPresignedGetUrl,
  deleteObjectFromS3,
} from '../../common/services/s3Storage.js';

export interface S3Playback {
  bucket: string;
  key: string;
}

export interface VideoListItem {
  id: string;
  jobId: string;
  filename: string;
  url: string;
  size: number;
  status: string;
  lastError: string;
  attempts: number;
  progressStage: string;
  progressMessage: string;
  createdAt: string;
}

export interface PreviewTopicInput {
  topic?: string;
  language?: string;
  translateTopic?: boolean;
  enhanceTopic?: boolean;
  openaiModel?: string;
}

export interface GenerateVideosInput {
  topic?: string;
  topics?: unknown;
  questionCount?: number;
  mcqSource?: string;
  manualQuizzes?: MCQ[];
  ttsProvider?: string;
  theme?: unknown;
  introTheme?: unknown;
  outroTheme?: unknown;
  textAlign?: unknown;
  language?: string;
  difficulty?: unknown;
  tone?: unknown;
  audience?: string;
  customInstructions?: string;
  guidelines?: string;
  openaiModel?: string;
  layoutDensity?: number;
  headerTitle?: string;
  ttsVoice?: string;
  ttsModel?: string;
  systemVoice?: string;
  elevenlabsModelId?: string;
  seriesName?: string;
  translateTopic?: boolean;
  enhanceTopic?: boolean;
}

export interface GeneratedVideoJob {
  jobId: string;
  videoId: string;
  status: string;
  topic: string;
}

type VideoDoc = {
  status: string;
  filename: string;
  filePath?: string;
  s3Bucket?: string;
  s3Key?: string;
  _id: { toString(): string };
};

/** Prefer stored S3 fields; otherwise infer key used by the worker (Lambda + S3). */
export function resolveS3Playback(
  video: { status: string; filename: string; s3Bucket?: string; s3Key?: string },
  userId: string
): S3Playback | null {
  const b = (video.s3Bucket || '').trim();
  const k = (video.s3Key || '').trim();
  if (b && k) return { bucket: b, key: k };
  const bucket = process.env.S3_OUTPUT_BUCKET?.trim();
  if (!bucket || video.status !== 'completed') return null;
  const fn = (video.filename || '').trim();
  if (!fn) return null;
  return { bucket, key: `${userId}/${fn}` };
}

export async function listUserVideos(userId: string): Promise<VideoListItem[]> {
  const videos = await Video.find({ userId }).sort({ createdAt: -1 });
  return videos.map((v) => ({
    id: v._id.toString(),
    jobId: v.jobId,
    filename: v.filename,
    url: `/api/videos/files/${userId}/${v.filename}`,
    size: v.size,
    status: v.status,
    lastError: v.lastError || '',
    attempts: v.attempts || 0,
    progressStage: (v as { progressStage?: string }).progressStage || '',
    progressMessage: (v as { progressMessage?: string }).progressMessage || '',
    createdAt: v.createdAt.toISOString(),
  }));
}

export async function findUserVideoById(videoId: string, userId: string) {
  return Video.findOne({ _id: videoId, userId });
}

export async function findUserVideoByFilename(userId: string, filename: string) {
  return Video.findOne({ userId, filename }).lean();
}

export async function getPresignedUrlForPlayback(
  video: { status: string; filename: string; s3Bucket?: string; s3Key?: string },
  userId: string
): Promise<string | null> {
  const s3 = resolveS3Playback(video, userId);
  if (!s3) return null;
  return getPresignedGetUrl(s3.bucket, s3.key);
}

export function resolveLocalVideoPath(env: EnvConfig, userId: string, filename: string): string {
  return path.resolve(env.OUTPUT_DIR, userId, filename);
}

export function resolveVideoFilePath(video: { filePath?: string }): string {
  return path.resolve(video.filePath || '');
}

export function localVideoExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export async function deleteUserVideo(userId: string, videoId: string): Promise<boolean> {
  const video = await Video.findOne({ _id: videoId, userId });
  if (!video) return false;

  const filePath = path.resolve(video.filePath);
  try {
    const s3Del = resolveS3Playback(video, userId);
    if (s3Del) {
      try {
        await deleteObjectFromS3(s3Del.bucket, s3Del.key);
      } catch {
        // ignore (missing key, etc.)
      }
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }

  await Video.deleteOne({ _id: video._id, userId });
  return true;
}

export async function previewTopicForUser(userId: string, input: PreviewTopicInput) {
  const raw = String(input.topic || '').trim();
  if (!raw) {
    throw new Error('topic required');
  }

  const langCode = normalizeQuizLanguage(typeof input.language === 'string' ? input.language : 'en');
  const settings = await loadSettings(userId);
  const { apiKey: openaiKey, apiUrl: openaiBaseUrl } = resolveOpenAiCredentials(settings);
  if (!openaiKey) {
    throw new Error('OpenAI API key required. Set it in Settings.');
  }

  return prepareTopicForQuizGeneration({
    apiKey: openaiKey,
    apiUrl: openaiBaseUrl,
    model: typeof input.openaiModel === 'string' ? input.openaiModel : undefined,
    topicInput: raw,
    languageCode: langCode,
    translateTopic: Boolean(input.translateTopic),
    enhanceTopic: Boolean(input.enhanceTopic),
  });
}

export async function generateVideosForUser(
  userId: string,
  env: EnvConfig,
  body: GenerateVideosInput
): Promise<GeneratedVideoJob[]> {
  const {
    topic = 'Quiz',
    topics,
    questionCount = 5,
    mcqSource = 'openai',
    manualQuizzes,
    ttsProvider = 'system',
    theme,
    introTheme,
    outroTheme,
    textAlign,
    language,
    difficulty,
    tone,
    audience,
    customInstructions,
    guidelines,
    openaiModel,
    layoutDensity: rawLayoutDensity,
    headerTitle,
    ttsVoice,
    ttsModel,
    systemVoice,
    elevenlabsModelId,
    seriesName,
  } = body;

  const topicList: string[] =
    Array.isArray(topics) && topics.length > 0
      ? topics.map((t) => String(t || '').trim()).filter(Boolean)
      : [String(topic || 'Quiz').trim()].filter(Boolean);

  if (topicList.length === 0) {
    throw new Error('topic/topics required');
  }

  const layoutDensity =
    typeof rawLayoutDensity === 'number' && !Number.isNaN(rawLayoutDensity)
      ? Math.min(1.25, Math.max(0.75, rawLayoutDensity))
      : undefined;

  const langCode = normalizeQuizLanguage(language);

  const settings = await loadSettings(userId);
  const { apiKey: openaiKey, apiUrl: openaiBaseUrl } = resolveOpenAiCredentials(settings);
  const tts = (ttsProvider || settings.tts.provider || 'system') as 'openai' | 'system' | 'elevenlabs';

  const userVideoDir = path.join(env.OUTPUT_DIR, userId);
  if (!fs.existsSync(userVideoDir)) fs.mkdirSync(userVideoDir, { recursive: true });

  const created: GeneratedVideoJob[] = [];

  for (let i = 0; i < topicList.length; i++) {
    const topicItem = topicList[i];
    let topicForDisplay = topicItem;

    let mcqs: MCQ[];
    if (mcqSource === 'manual' && manualQuizzes && manualQuizzes.length > 0) {
      mcqs = manualQuizzes;
    } else {
      if (!openaiKey) {
        throw new Error('OpenAI API key required for AI quiz generation. Set it in Settings.');
      }
      const translateTopic = langCode !== 'en' && body.translateTopic !== false;
      const enhanceTopic = body.enhanceTopic !== false;
      let topicForMcq = topicItem;
      if (translateTopic || enhanceTopic) {
        try {
          const prep = await prepareTopicForQuizGeneration({
            apiKey: openaiKey,
            apiUrl: openaiBaseUrl,
            model: typeof openaiModel === 'string' ? openaiModel : undefined,
            topicInput: topicItem,
            languageCode: langCode,
            translateTopic,
            enhanceTopic,
          });
          topicForDisplay = prep.localizedLabel;
          topicForMcq = prep.promptSubject;
        } catch (e) {
          console.warn('Topic localization/enhancement failed, using raw topic:', e);
        }
      }
      const mcqOptions: MCQGenerationOptions = {
        apiKey: openaiKey,
        apiUrl: openaiBaseUrl,
        language: langCode,
        audience: typeof audience === 'string' ? audience : undefined,
        customInstructions: typeof customInstructions === 'string' ? customInstructions : undefined,
        guidelines: typeof guidelines === 'string' ? guidelines : undefined,
        model: typeof openaiModel === 'string' ? openaiModel : undefined,
      };
      if (typeof difficulty === 'string') mcqOptions.difficulty = difficulty as MCQGenerationOptions['difficulty'];
      if (typeof tone === 'string') mcqOptions.tone = tone as MCQGenerationOptions['tone'];
      mcqs = await generateMCQs(topicForMcq, questionCount, mcqOptions);
      if (questionCount > 0) mcqs = mcqs.slice(0, questionCount);
    }

    const quizzes: Quiz[] = mcqs
      .map((mcq: MCQ): Quiz | null => {
        const options = Array.isArray((mcq as any).options)
          ? (mcq as any).options
          : Object.values((mcq as any).options || {});
        if (options.length !== 4) return null;
        return {
          question: (mcq as any).question,
          options: options as [string, string, string, string],
          answerIndex: (mcq as any).answerIndex as 0 | 1 | 2 | 3,
          language: langCode,
        };
      })
      .filter((q): q is Quiz => q !== null);

    if (quizzes.length === 0) {
      continue;
    }

    const renderId = `quiz_video_${Date.now()}_${i}`;
    const filename = `${renderId}.mp4`;
    const filePath = path.resolve(path.join(userVideoDir, filename));

    const requestPayload = {
      topic: topicForDisplay,
      questionCount,
      mcqSource,
      manualQuizzes,
      quizzes,
      ttsProvider: tts,
      theme,
      introTheme,
      outroTheme,
      textAlign,
      language: langCode,
      difficulty,
      tone,
      audience,
      customInstructions,
      guidelines: typeof guidelines === 'string' ? guidelines : undefined,
      openaiModel,
      layoutDensity,
      seriesName: typeof seriesName === 'string' ? seriesName.trim().slice(0, 48) : undefined,
      headerTitle: typeof headerTitle === 'string' ? headerTitle.slice(0, 32) : undefined,
      ttsVoice: typeof ttsVoice === 'string' ? ttsVoice : undefined,
      ttsModel: typeof ttsModel === 'string' ? ttsModel : undefined,
      systemVoice: typeof systemVoice === 'string' ? systemVoice : undefined,
      elevenlabsModelId: typeof elevenlabsModelId === 'string' ? elevenlabsModelId : undefined,
    };
    const requestJson = JSON.stringify(requestPayload);
    const inputHash = crypto.createHash('sha256').update(requestJson).digest('hex');

    const videoDoc = await Video.create({
      userId,
      jobId: renderId,
      filename,
      filePath,
      requestJson,
      attempts: 0,
      lastError: '',
    });
    const jobDoc = await VideoJob.create({
      userId,
      videoId: videoDoc._id,
      status: 'queued',
      attempts: 0,
      cancelRequested: false,
      inputHash,
      stage: 'queued',
      message: 'Queued',
      events: [{ at: new Date(), stage: 'queued', message: 'Queued' }],
    });
    await Video.findByIdAndUpdate(videoDoc._id, { $set: { jobId: jobDoc._id.toString() } }).catch(() => {});

    created.push({
      jobId: jobDoc._id.toString(),
      videoId: videoDoc._id.toString(),
      status: 'generating',
      topic: topicForDisplay,
    });
    void queueVideoJob(videoDoc._id.toString());
  }

  if (created.length === 0) {
    throw new Error('No valid quizzes to render');
  }

  return created;
}

export function getS3PlaybackForVideo(video: VideoDoc, userId: string): S3Playback | null {
  return resolveS3Playback(video, userId);
}
