import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';

import type { EnvConfig } from './config/envConfig.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createUploadRoutes } from './routes/uploadRoutes.js';
import { createSettingsRoutes } from './routes/settingsRoutes.js';
import { createTtsPreviewRoutes } from './routes/ttsPreviewRoutes.js';
import { createPublishRoutes } from './routes/publishRoutes.js';
import { createAnalyticsRoutes } from './routes/analyticsRoutes.js';
import { createAdminRoutes } from './routes/adminRoutes.js';
import { createJobRoutes } from './routes/jobsRoutes.js';
import { createUploadFilesRoutes } from './routes/uploadFilesRoutes.js';
import { createVideoRoutes } from './routes/videosRoutes.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { auditMiddleware } from './middleware/audit.js';

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
  app.use('/api/publish', authMiddleware, createPublishRoutes());
  app.use('/api/analytics', authMiddleware, createAnalyticsRoutes());
  app.use('/api/admin', authMiddleware, createAdminRoutes());

  app.use('/api/videos', createVideoRoutes(env));

  app.use('/api/jobs', authMiddleware, createJobRoutes());

  app.use('/api/uploads', authMiddleware, createUploadFilesRoutes(env));
  app.use('/api/uploads', authMiddleware, createUploadRoutes(env));

  const frontendDist = path.resolve('./frontend/dist');
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
