import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';

import type { EnvConfig } from './common/config/envConfig.js';
import { authMiddleware, createAuthRoutes, createAdminRoutes } from './auth/index.js';
import { createSettingsRoutes } from './common/controllers/settingsController.js';
import { createTtsPreviewRoutes } from './common/controllers/ttsPreviewController.js';
import { createPublishRoutes, handleYouTubeOAuthCallback } from './common/controllers/publishController.js';
import { createAnalyticsRoutes } from './common/controllers/analyticsController.js';
import { createUploadFilesRoutes } from './common/controllers/uploadFilesController.js';
import { createVideoRoutes } from './mcq/controllers/videosController.js';
import { createJobRoutes } from './mcq/controllers/jobsController.js';
import { createUploadRoutes } from './mcq/controllers/uploadController.js';
import { createStoryVideoRoutes } from './story/controllers/storyVideoController.js';
import { errorHandler } from './common/middleware/errorHandler.js';
import { auditMiddleware } from './common/middleware/audit.js';
import { frontendDistPath } from './common/config/paths.js';

export function createApp(env: EnvConfig): express.Application {
  const app = express();
  app.set('trust proxy', 1);
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
  app.use(auditMiddleware);

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

  const storyVideoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1, parseInt(process.env.STORY_VIDEO_RATE_LIMIT_MAX || '40', 10)),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      if (req.method !== 'GET') return false;
      const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
      return (
        /\/story-video\/jobs(\?|$)/.test(pathOnly) ||
        /\/story-video\/[^/]+\/(status|result|play)$/.test(pathOnly) ||
        /\/story-video\/[^/]+\/subtitles\.srt$/.test(pathOnly) ||
        /\/story-video\/files\/[^/]+\/(output\.mp4|original)$/.test(pathOnly) ||
        /\/story-video\/user-media\//.test(pathOnly)
      );
    },
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
  // YouTube OAuth callback: browser redirect from Google has no JWT — user id comes from `state`.
  app.get('/api/publish/youtube/callback', (req, res) => {
    void handleYouTubeOAuthCallback(req, res);
  });
  app.use('/api/publish', authMiddleware, createPublishRoutes());
  app.use('/api/analytics', authMiddleware, createAnalyticsRoutes());
  app.use('/api/admin', authMiddleware, createAdminRoutes());
  app.use('/api/videos', createVideoRoutes(env));
  app.use('/api/jobs', authMiddleware, createJobRoutes());
  app.use('/api/story-video', authMiddleware, storyVideoLimiter, createStoryVideoRoutes(env));
  app.use('/api/uploads', authMiddleware, createUploadFilesRoutes(env));
  app.use('/api/uploads', authMiddleware, createUploadRoutes(env));

  const frontendDist = frontendDistPath();
  if (fs.existsSync(frontendDist)) {
    const devUi = env.NODE_ENV === 'development';
    app.use(
      express.static(frontendDist, {
        maxAge: devUi ? 0 : undefined,
        setHeaders(res) {
          if (devUi) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      if (devUi) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
