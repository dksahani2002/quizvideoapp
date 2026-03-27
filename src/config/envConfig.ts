interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  OPENAI_API_KEY: string;
  OPENAI_URL: string;
  YT_CLIENT_ID: string;
  YT_CLIENT_SECRET: string;
  YT_REDIRECT_URI: string;
  YT_REFRESH_TOKEN: string;
  IG_USERNAME?: string;
  IG_PASSWORD?: string;
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

const DEV_JWT_PLACEHOLDER = 'mcq-shorts-dev-secret-change-in-production';

export function loadEnvConfig(): EnvConfig {
  return {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    PORT: parseInt(process.env.PORT || '3000', 10),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_URL: process.env.OPENAI_URL || 'https://api.openai.com/v1',
    YT_CLIENT_ID: process.env.YT_CLIENT_ID || '',
    YT_CLIENT_SECRET: process.env.YT_CLIENT_SECRET || '',
    YT_REDIRECT_URI: process.env.YT_REDIRECT_URI || '',
    YT_REFRESH_TOKEN: process.env.YT_REFRESH_TOKEN || '',
    IG_USERNAME: process.env.IG_USERNAME,
    IG_PASSWORD: process.env.IG_PASSWORD,
    TOPIC: process.env.TOPIC || 'Quiz',
    OUTPUT_DIR: process.env.OUTPUT_DIR || './output/videos',
    UPLOADS_DIR: process.env.UPLOADS_DIR || './uploads',
    CACHE_DIR: process.env.CACHE_DIR || './cache',
    TEMP_DIR: process.env.TEMP_DIR || './temp',
    FONT_FILE: process.env.FONT_FILE,
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017',
    DB_NAME: process.env.DB_NAME || 'mcq_shorts',
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
}

export type { EnvConfig };
