interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  /** AWS KMS key id/arn for encrypting user secrets at rest (recommended in production). */
  KMS_KEY_ID?: string;
  /**
   * Local/dev fallback for encrypting secrets when KMS is unavailable.
   * 32+ bytes, base64 or utf8. In production prefer KMS_KEY_ID.
   */
  APP_ENCRYPTION_KEY?: string;
  /** Meta (Facebook) app credentials for Instagram Graph API OAuth. */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_REDIRECT_URI?: string;
  TOPIC?: string;
  OUTPUT_DIR: string;
  UPLOADS_DIR: string;
  CACHE_DIR: string;
  TEMP_DIR: string;
  FONT_FILE?: string;
  MONGO_URI: string;
  DB_NAME: string;
  JWT_SECRET: string;
  /** Comma-separated origins for CORS (e.g. https://app.example.com). Empty = reflect request origin in dev. */
  CORS_ORIGIN: string;
  /** Max requests per IP per window for /api/auth (login, register). */
  AUTH_RATE_LIMIT_MAX: number;
  /** Max requests per IP per window for /api/tts/preview. */
  TTS_PREVIEW_RATE_LIMIT_MAX: number;
  /** Default JSON body limit for API routes (not uploads). */
  JSON_BODY_LIMIT: string;
}

import fs from 'node:fs';
import path from 'node:path';

const DEV_JWT_PLACEHOLDER = 'mcq-shorts-dev-secret-change-in-production';

type FileConfig = Partial<Pick<EnvConfig, 'MONGO_URI' | 'DB_NAME'>>;

function loadFileConfig(): FileConfig {
  const configPath = process.env.APP_CONFIG_PATH
    ? path.resolve(process.env.APP_CONFIG_PATH)
    : path.join(process.cwd(), 'config.local.json');

  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: FileConfig = {};
    if (typeof parsed.MONGO_URI === 'string' && parsed.MONGO_URI.trim()) out.MONGO_URI = parsed.MONGO_URI.trim();
    if (typeof parsed.DB_NAME === 'string' && parsed.DB_NAME.trim()) out.DB_NAME = parsed.DB_NAME.trim();
    return out;
  } catch {
    return {};
  }
}

export function loadEnvConfig(): EnvConfig {
  const file = loadFileConfig();
  return {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    PORT: parseInt(process.env.PORT || '3000', 10),
    KMS_KEY_ID: process.env.KMS_KEY_ID,
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_REDIRECT_URI: process.env.META_REDIRECT_URI,
    TOPIC: process.env.TOPIC || 'Quiz',
    OUTPUT_DIR: process.env.OUTPUT_DIR || './output/videos',
    UPLOADS_DIR: process.env.UPLOADS_DIR || './uploads',
    CACHE_DIR: process.env.CACHE_DIR || './cache',
    TEMP_DIR: process.env.TEMP_DIR || './temp',
    FONT_FILE: process.env.FONT_FILE,
    MONGO_URI: process.env.MONGO_URI || file.MONGO_URI || 'mongodb://localhost:27017',
    DB_NAME: process.env.DB_NAME || file.DB_NAME || 'mcq_shorts',
    JWT_SECRET: process.env.JWT_SECRET || DEV_JWT_PLACEHOLDER,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '',
    AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '100', 10),
    TTS_PREVIEW_RATE_LIMIT_MAX: parseInt(process.env.TTS_PREVIEW_RATE_LIMIT_MAX || '30', 10),
    JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || '2mb',
  };
}

/** Call before listening. Throws if production config is unsafe. */
export function assertProductionConfig(env: EnvConfig): void {
  if (env.NODE_ENV !== 'production') return;
  const s = env.JWT_SECRET || '';
  if (s.length < 32 || s === DEV_JWT_PLACEHOLDER) {
    throw new Error(
      'Production requires JWT_SECRET: set a random string of at least 32 characters (never use the dev default).'
    );
  }
  const hasKms = !!(env.KMS_KEY_ID && env.KMS_KEY_ID.trim());
  const hasAppKey = !!(env.APP_ENCRYPTION_KEY && env.APP_ENCRYPTION_KEY.trim() && env.APP_ENCRYPTION_KEY.trim().length >= 32);
  if (!hasKms && !hasAppKey) {
    throw new Error('Production requires KMS_KEY_ID or APP_ENCRYPTION_KEY (32+ chars) to encrypt user secrets at rest.');
  }
}

export type { EnvConfig };
