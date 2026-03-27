import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import type { EnvConfig } from '../config/envConfig.js';
import { authMiddleware } from '../middleware/auth.js';
import { loadSettings } from '../services/settingsService.js';
import { Video } from '../db/models/Video.js';
import { VideoJob } from '../db/models/VideoJob.js';
import { generateMCQs, MCQ } from '../agents/mcqAgent.js';
import type { Quiz } from '../types/index.js';
import { queueVideoJob } from '../utils/queueVideoJob.js';
import { normalizeQuizLanguage } from '../utils/quizLanguages.js';
import { prepareTopicForQuizGeneration } from '../utils/topicLocalization.js';
import {
  getPresignedGetUrl,
  deleteObjectFromS3,
  streamS3ObjectToHttpResponse,
} from '../services/s3Storage.js';

/** Prefer stored S3 fields; otherwise infer key used by the worker (Lambda + S3). */
function resolveS3Playback(
  video: { status: string; filename: string; s3Bucket?: string; s3Key?: string },
  userId: string
): { bucket: string; key: string } | null {
  const b = (video.s3Bucket || '').trim();
  const k = (video.s3Key || '').trim();
  if (b && k) return { bucket: b, key: k };
  const bucket = process.env.S3_OUTPUT_BUCKET?.trim();
  if (!bucket || video.status !== 'completed') return null;
  const fn = (video.filename || '').trim();
  if (!fn) return null;
  return { bucket, key: `${userId}/${fn}` };
}

export function createVideosRoutes(env: EnvConfig): Router {
  const router = Router();

  // Stream endpoint for local/dev playback (no Authorization header required).
  // This is used when the video is on local disk (no S3), because <video> cannot send Bearer tokens.
  router.get('/:id/stream', async (req: Request, res: Response) => {
    let decoded: { videoId: string; userId: string };
    try {
      const token = (typeof req.query.token === 'string' ? req.query.token : '').trim();
      if (!token) {
        res.status(401).json({ success: false, error: 'Missing token' });
        return;
      }
      decoded = jwt.verify(token, env.JWT_SECRET) as { videoId: string; userId: string };
      if (!decoded?.videoId || decoded.videoId !== req.params.id) {
        res.status(401).json({ success: false, error: 'Invalid token' });
        return;
      }
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }

    try {
      const video = await Video.findOne({ _id: decoded.videoId, userId: decoded.userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      const s3 = resolveS3Playback(video, decoded.userId);
      if (s3) {
        await streamS3ObjectToHttpResponse(s3.bucket, s3.key, req, res);
        return;
      }
      const filePath = path.resolve(video.filePath);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'Video file missing' });
        return;
      }
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      if (!range) {
        res.status(200);
        res.setHeader('Content-Length', String(fileSize));
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.status(416).end();
        return;
      }
      const start = m[1] ? Math.min(parseInt(m[1], 10), fileSize - 1) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), fileSize - 1) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(chunkSize));
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: msg });
      }
    }
  });

  router.use(authMiddleware);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const videos = await Video.find({ userId }).sort({ createdAt: -1 });
      const data = videos.map((v) => ({
        id: v._id.toString(),
        jobId: v.jobId,
        filename: v.filename,
        url: `/api/videos/files/${userId}/${v.filename}`,
        size: v.size,
        status: v.status,
        lastError: v.lastError || '',
        attempts: v.attempts || 0,
        progressStage: (v as any).progressStage || '',
        progressMessage: (v as any).progressMessage || '',
        createdAt: v.createdAt.toISOString(),
      }));
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/files/:userId/:filename', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    if (userId !== req.params.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const doc = await Video.findOne({ userId, filename: req.params.filename }).lean();
    const s3Files = doc ? resolveS3Playback(doc as { status: string; filename: string; s3Bucket?: string; s3Key?: string }, userId) : null;
    if (s3Files) {
      try {
        const url = await getPresignedGetUrl(s3Files.bucket, s3Files.key);
        res.redirect(302, url);
      } catch (e) {
        console.error('S3 presign failed:', e);
        res.status(500).json({ success: false, error: 'Could not load video' });
      }
      return;
    }
    const filePath = path.resolve(env.OUTPUT_DIR, userId, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'Video not found' });
      return;
    }
    res.sendFile(filePath);
  });

  // Get a direct playback URL for <video src="...">.
  // Needed because the HTML media element can't send Authorization headers.
  router.get('/:id/play', async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      const s3Play = resolveS3Playback(video, userId);
      if (s3Play) {
        const url = await getPresignedGetUrl(s3Play.bucket, s3Play.key);
        res.json({ success: true, url });
        return;
      }
      const playToken = jwt.sign({ videoId: video._id.toString(), userId }, env.JWT_SECRET, { expiresIn: '10m' });
      res.json({ success: true, url: `/api/videos/${video._id.toString()}/stream?token=${encodeURIComponent(playToken)}` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  });

  router.get('/:id/download', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      const s3Dl = resolveS3Playback(video, userId);
      if (s3Dl) {
        const url = await getPresignedGetUrl(s3Dl.bucket, s3Dl.key);
        res.redirect(302, url);
        return;
      }
      const filePath = path.resolve(video.filePath);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'Video file missing' });
        return;
      }
      res.download(filePath, video.filename);
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }

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
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /** Preview topic translation / enhancement (same OpenAI step as generate, without creating a job). */
  router.post('/preview-topic', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const { topic, language, translateTopic: rawTranslate, enhanceTopic: rawEnhance, openaiModel } = req.body as {
        topic?: string;
        language?: string;
        translateTopic?: boolean;
        enhanceTopic?: boolean;
        openaiModel?: string;
      };
      const raw = String(topic || '').trim();
      if (!raw) {
        res.status(400).json({ success: false, error: 'topic required' });
        return;
      }

      const langCode = normalizeQuizLanguage(typeof language === 'string' ? language : 'en');
      const settings = await loadSettings(userId);
      const openaiKey = (settings.openai.apiKey || '').trim();
      if (!openaiKey) {
        res.status(400).json({
          success: false,
          error: 'OpenAI API key required. Set it in Settings.',
        });
        return;
      }

      const translateTopic = Boolean(rawTranslate);
      const enhanceTopic = Boolean(rawEnhance);

      const prep = await prepareTopicForQuizGeneration({
        apiKey: openaiKey,
        apiUrl: settings.openai.apiUrl || 'https://api.openai.com/v1',
        model: typeof openaiModel === 'string' ? openaiModel : undefined,
        topicInput: raw,
        languageCode: langCode,
        translateTopic,
        enhanceTopic,
      });

      res.json({ success: true, data: prep });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.post('/generate', async (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
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
      } = req.body;

      const topicList: string[] =
        Array.isArray(topics) && topics.length > 0
          ? topics.map((t: any) => String(t || '').trim()).filter(Boolean)
          : [String(topic || 'Quiz').trim()].filter(Boolean);

      if (topicList.length === 0) {
        res.status(400).json({ success: false, error: 'topic/topics required' });
        return;
      }

      const layoutDensity =
        typeof rawLayoutDensity === 'number' && !Number.isNaN(rawLayoutDensity)
          ? Math.min(1.25, Math.max(0.75, rawLayoutDensity))
          : undefined;

      const langCode = normalizeQuizLanguage(language);

      const settings = await loadSettings(userId);
      const openaiKey = (settings.openai.apiKey || '').trim();
      const tts = (ttsProvider || settings.tts.provider || 'system') as 'openai' | 'system' | 'elevenlabs';

      const userVideoDir = path.join(env.OUTPUT_DIR, userId);
      if (!fs.existsSync(userVideoDir)) fs.mkdirSync(userVideoDir, { recursive: true });

      const created: Array<{ jobId: string; videoId: string; status: string; topic: string }> = [];

      for (let i = 0; i < topicList.length; i++) {
        const topicItem = topicList[i];
        let topicForDisplay = topicItem;

        let mcqs: MCQ[];
        if (mcqSource === 'manual' && manualQuizzes && manualQuizzes.length > 0) {
          mcqs = manualQuizzes;
        } else {
          if (!openaiKey) {
            res.status(400).json({ success: false, error: 'OpenAI API key required for AI quiz generation. Set it in Settings.' });
            return;
          }
          const translateTopic = langCode !== 'en' && req.body.translateTopic !== false;
          const enhanceTopic = req.body.enhanceTopic !== false;
          let topicForMcq = topicItem;
          if (translateTopic || enhanceTopic) {
            try {
              const prep = await prepareTopicForQuizGeneration({
                apiKey: openaiKey,
                apiUrl: settings.openai.apiUrl || 'https://api.openai.com/v1',
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
          mcqs = await generateMCQs(topicForMcq, questionCount, {
            apiKey: openaiKey,
            apiUrl: settings.openai.apiUrl || 'https://api.openai.com/v1',
            language: langCode,
            difficulty,
            tone,
            audience: typeof audience === 'string' ? audience : undefined,
            customInstructions: typeof customInstructions === 'string' ? customInstructions : undefined,
            guidelines: typeof guidelines === 'string' ? guidelines : undefined,
            model: typeof openaiModel === 'string' ? openaiModel : undefined,
          });
          if (questionCount > 0) mcqs = mcqs.slice(0, questionCount);
        }

        const quizzes: Quiz[] = mcqs
          .map((mcq: MCQ): Quiz | null => {
            const options = Array.isArray((mcq as any).options) ? (mcq as any).options : Object.values((mcq as any).options || {});
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

        created.push({ jobId: jobDoc._id.toString(), videoId: videoDoc._id.toString(), status: 'generating', topic: topicForDisplay });
        void queueVideoJob(videoDoc._id.toString());
      }

      if (created.length === 0) {
        res.status(400).json({ success: false, error: 'No valid quizzes to render' });
        return;
      }

      res.json({ success: true, data: created });
    } catch (error: any) {
      console.error('Video generation failed:', error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error?.message || 'Video generation failed' });
      }
    }
  });

  return router;
}

// Backward-compatible alias while normalizing route factory naming.
export const createVideoRoutes = createVideosRoutes;

