import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

import type { EnvConfig } from './config/envConfig.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createUploadRoutes } from './routes/uploadRoutes.js';
import { createSettingsRoutes } from './routes/settingsRoutes.js';
import { createTtsPreviewRoutes } from './routes/ttsPreviewRoutes.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { loadSettings } from './services/settingsService.js';
import { Video } from './db/models/Video.js';
import { Upload } from './db/models/Upload.js';
import { generateMCQs, MCQ } from './agents/mcqAgent.js';
import { Quiz } from './types/index.js';
import { queueVideoJob } from './utils/queueVideoJob.js';
import { getPresignedGetUrl, deleteObjectFromS3 } from './services/s3Storage.js';

export function createApp(env: EnvConfig): express.Application {
  const app = express();
  app.set('trust proxy', 1);
  // Avoid 304 Not Modified responses for API calls like `/api/videos/:id/play`.
  // The frontend treats non-2xx as failure, and presigned URLs should not be cached.
  app.set('etag', false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const corsOrigins = env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        if (corsOrigins.length === 0) {
          cb(null, true);
          return;
        }
        if (!origin) {
          cb(null, true);
          return;
        }
        cb(null, corsOrigins.includes(origin));
      },
    })
  );

  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  const jsonDefault = express.json({ limit: env.JSON_BODY_LIMIT });
  const jsonLarge = express.json({ limit: '50mb' });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/api/uploads/background') {
      return jsonLarge(req, res, next);
    }
    return jsonDefault(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1, env.AUTH_RATE_LIMIT_MAX),
    standardHeaders: true,
    legacyHeaders: false,
  });

  const ttsPreviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1, env.TTS_PREVIEW_RATE_LIMIT_MAX),
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/health', (_req, res) => {
    const dbOk = mongoose.connection.readyState === 1;
    const status = dbOk ? 'ok' : 'degraded';
    res.status(dbOk ? 200 : 503).json({
      status,
      database: dbOk ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', authLimiter, createAuthRoutes());

  app.use('/api/settings', authMiddleware, createSettingsRoutes());
  app.use('/api/tts', ttsPreviewLimiter, authMiddleware, createTtsPreviewRoutes());

  app.get('/api/videos', authMiddleware, async (req, res) => {
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

  app.get('/api/videos/files/:userId/:filename', authMiddleware, async (req, res) => {
    const userId = req.user!.id;
    if (userId !== req.params.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const doc = await Video.findOne({ userId, filename: req.params.filename }).lean();
    if (doc?.s3Bucket && doc?.s3Key) {
      try {
        const url = await getPresignedGetUrl(doc.s3Bucket, doc.s3Key);
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

  // Stream endpoint for local/dev playback (no Authorization header required).
  // This is used when the video is on local disk (no S3), because <video> cannot send Bearer tokens.
  app.get('/api/videos/:id/stream', async (req, res) => {
    try {
      const token = (typeof req.query.token === 'string' ? req.query.token : '').trim();
      if (!token) {
        res.status(401).json({ success: false, error: 'Missing token' });
        return;
      }
      const decoded = jwt.verify(token, env.JWT_SECRET) as { videoId: string; userId: string };
      if (!decoded?.videoId || decoded.videoId !== req.params.id) {
        res.status(401).json({ success: false, error: 'Invalid token' });
        return;
      }
      const video = await Video.findOne({ _id: decoded.videoId, userId: decoded.userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      const filePath = path.resolve(video.filePath);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'Video file missing' });
        return;
      }
      // Use explicit byte-range streaming; some browsers (notably Safari/iOS) are strict here.
      // Also avoid conditional caching (304) which can confuse media pipelines.
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
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token' });
    }
  });

  // Get a direct playback URL for <video src="...">.
  // Needed because the HTML media element can't send Authorization headers.
  app.get('/api/videos/:id/play', authMiddleware, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      if (video.s3Bucket && video.s3Key) {
        const url = await getPresignedGetUrl(video.s3Bucket, video.s3Key);
        res.json({ success: true, url });
        return;
      }
      // Local/dev fallback: return a short-lived tokenized URL (same origin, no Authorization header required).
      const playToken = jwt.sign({ videoId: video._id.toString(), userId }, env.JWT_SECRET, { expiresIn: '10m' });
      res.json({ success: true, url: `/api/videos/${video._id.toString()}/stream?token=${encodeURIComponent(playToken)}` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/videos/:id/download', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }
      if (video.s3Bucket && video.s3Key) {
        const url = await getPresignedGetUrl(video.s3Bucket, video.s3Key);
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

  app.delete('/api/videos/:id', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;
      const video = await Video.findOne({ _id: req.params.id, userId });
      if (!video) {
        res.status(404).json({ success: false, error: 'Video not found' });
        return;
      }

      const filePath = path.resolve(video.filePath);
      try {
        if (video.s3Bucket && video.s3Key) {
          await deleteObjectFromS3(video.s3Bucket, video.s3Key);
        } else if (fs.existsSync(filePath)) {
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

  app.post('/api/uploads/background', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { image, filename } = req.body;
      if (!image || !filename) {
        res.status(400).json({ success: false, error: 'image and filename required' });
        return;
      }

      const userUploadDir = path.resolve(path.join(env.UPLOADS_DIR, userId));
      if (!fs.existsSync(userUploadDir)) fs.mkdirSync(userUploadDir, { recursive: true });

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const outPath = path.join(userUploadDir, filename);
      fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));

      await Upload.create({ userId, filename, filePath: outPath });

      res.json({ success: true, path: outPath, url: `/api/uploads/files/${userId}/${filename}` });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/uploads/files/:userId/:filename', authMiddleware, (req, res) => {
    const userId = req.user!.id;
    if (userId !== req.params.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const filePath = path.resolve(env.UPLOADS_DIR, userId, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.sendFile(filePath);
  });

  app.post('/api/videos/generate', authMiddleware, async (req, res) => {
    const userId = req.user!.id;
    try {
      const {
        topic = 'Quiz',
        questionCount = 5,
        mcqSource = 'openai',
        manualQuizzes,
        ttsProvider = 'system',
        theme,
        textAlign,
        language,
        difficulty,
        tone,
        audience,
        customInstructions,
        openaiModel,
        layoutDensity: rawLayoutDensity,
        headerTitle,
        ttsVoice,
        ttsModel,
        systemVoice,
        elevenlabsModelId,
      } = req.body;

      const layoutDensity =
        typeof rawLayoutDensity === 'number' && !Number.isNaN(rawLayoutDensity)
          ? Math.min(1.25, Math.max(0.75, rawLayoutDensity))
          : undefined;

      const settings = await loadSettings(userId);
      const openaiKey = settings.openai.apiKey || env.OPENAI_API_KEY;
      const tts = (ttsProvider || settings.tts.provider || 'system') as 'openai' | 'system' | 'elevenlabs';

      let mcqs: MCQ[];
      if (mcqSource === 'manual' && manualQuizzes && manualQuizzes.length > 0) {
        mcqs = manualQuizzes;
      } else {
        if (!openaiKey) {
          res.status(400).json({ success: false, error: 'OpenAI API key required for AI quiz generation. Set it in Settings.' });
          return;
        }
        mcqs = await generateMCQs(topic, questionCount, {
          apiKey: openaiKey,
          apiUrl: settings.openai.apiUrl || env.OPENAI_URL,
          language: typeof language === 'string' ? language : undefined,
          difficulty,
          tone,
          audience: typeof audience === 'string' ? audience : undefined,
          customInstructions: typeof customInstructions === 'string' ? customInstructions : undefined,
          model: typeof openaiModel === 'string' ? openaiModel : undefined,
        });
        if (questionCount > 0) mcqs = mcqs.slice(0, questionCount);
      }

      const quizzes: Quiz[] = mcqs
        .map((mcq: MCQ): Quiz | null => {
          const options = Array.isArray(mcq.options) ? mcq.options : Object.values(mcq.options || {});
          if (options.length !== 4) return null;
          return {
            question: mcq.question,
            options: options as [string, string, string, string],
            answerIndex: mcq.answerIndex as 0 | 1 | 2 | 3,
            language: 'en',
          };
        })
        .filter((q): q is Quiz => q !== null);

      if (quizzes.length === 0) {
        res.status(400).json({ success: false, error: 'No valid quizzes to render' });
        return;
      }

      const jobId = `quiz_video_${Date.now()}`;
      const userVideoDir = path.join(env.OUTPUT_DIR, userId);
      if (!fs.existsSync(userVideoDir)) fs.mkdirSync(userVideoDir, { recursive: true });

      const filename = `${jobId}.mp4`;
      const filePath = path.resolve(path.join(userVideoDir, filename));

      const requestJson = JSON.stringify({
        topic,
        questionCount,
        mcqSource,
        manualQuizzes,
        quizzes,
        ttsProvider: tts,
        theme,
        textAlign,
        language,
        difficulty,
        tone,
        audience,
        customInstructions,
        openaiModel,
        layoutDensity,
        headerTitle: typeof headerTitle === 'string' ? headerTitle.slice(0, 32) : undefined,
        ttsVoice: typeof ttsVoice === 'string' ? ttsVoice : undefined,
        ttsModel: typeof ttsModel === 'string' ? ttsModel : undefined,
        systemVoice: typeof systemVoice === 'string' ? systemVoice : undefined,
        elevenlabsModelId: typeof elevenlabsModelId === 'string' ? elevenlabsModelId : undefined,
      });

      const videoDoc = await Video.create({
        userId,
        jobId,
        filename,
        filePath,
        requestJson,
        attempts: 0,
        lastError: '',
      });

      res.json({
        success: true,
        jobId,
        videoId: videoDoc._id.toString(),
        status: 'generating',
        quizCount: quizzes.length,
      });

      void queueVideoJob(videoDoc._id.toString());
    } catch (error: any) {
      console.error('Video generation failed:', error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error?.message || 'Video generation failed' });
      }
    }
  });

  app.use('/api/uploads', authMiddleware, createUploadRoutes(env));

  const frontendDist = path.resolve('./frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
