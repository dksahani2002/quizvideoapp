import { UserSettings } from '../db/models/UserSettings.js';
import { decryptJson, encryptJson } from './cryptoService.js';
import { BRAND_DEFAULTS_EN } from '../../mcq/utils/quizUiStrings.js';

export interface AppSettings {
  openai: {
    apiKey: string;
    apiUrl: string;
  };
  tts: {
    provider: 'system' | 'openai' | 'elevenlabs';
    voice: string;
  };
  elevenlabs: {
    apiKey: string;
    voiceId: string;
    voiceName: string;
    modelId: string;
  };
  youtube: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
  };
  /**
   * Instagram publishing via official Meta Graph API.
   * Tokens are stored encrypted at rest.
   */
  instagramGraph: {
    /** Facebook Page id that owns the connected Instagram Business account. */
    pageId: string;
    /** Instagram Business Account id. */
    igUserId: string;
    /** Long-lived access token (encrypted at rest). */
    accessToken: string;
    /** ISO timestamp when token expires (optional; some long-lived flows still expire). */
    tokenExpiresAt: string;
  };
  brand: {
    introScript: string;
    outroScript: string;
    ctaLine: string;
    watermarkImage: string;
    watermarkOpacity: number;
    watermarkPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  theme: {
    preset: string;
    customStops: Array<{ pos: number; color: string }>;
    backgroundImage: string;
    backgroundOpacity: number;
    textAlign: 'left' | 'center' | 'right';
    fontSize: 'small' | 'medium' | 'large';
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  openai: { apiKey: '', apiUrl: 'https://api.openai.com/v1' },
  tts: { provider: 'system', voice: 'Alex' },
  elevenlabs: { apiKey: '', voiceId: '', voiceName: '', modelId: 'eleven_turbo_v2_5' },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', refreshToken: '' },
  instagramGraph: { pageId: '', igUserId: '', accessToken: '', tokenExpiresAt: '' },
  brand: {
    introScript: BRAND_DEFAULTS_EN.introTemplate,
    outroScript: BRAND_DEFAULTS_EN.outroTemplate,
    ctaLine: '',
    watermarkImage: '',
    watermarkOpacity: 0.75,
    watermarkPosition: 'top-right',
  },
  theme: {
    preset: 'deep-purple',
    customStops: [],
    backgroundImage: '',
    backgroundOpacity: 1.0,
    textAlign: 'center',
    fontSize: 'medium',
  },
};

/**
 * When enabled (non-production only), empty OpenAI / YouTube / ElevenLabs fields are filled from process.env.
 * Production always uses per-user Settings only — env fallbacks are never applied.
 */
export function isSettingsFallbackFromEnvEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const v = process.env.SETTINGS_FALLBACK_FROM_ENV?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

/** Normalize OPENAI_URL (e.g. .../v1/chat/completions) to OpenAI client base URL. */
export function normalizeOpenAiBaseUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  let u = raw.trim().replace(/\s+/g, '').replace(/\/$/, '');
  u = u.replace(/\/chat\/completions$/i, '');
  return u || undefined;
}

/**
 * Resolves OpenAI key/URL for API workers. Server env is used only when {@link isSettingsFallbackFromEnvEnabled} is true.
 */
export function resolveOpenAiCredentials(settings: AppSettings): { apiKey: string; apiUrl: string } {
  const fallback = isSettingsFallbackFromEnvEnabled();
  const apiKey = (
    settings.openai.apiKey.trim() ||
    (fallback ? (process.env.OPENAI_API_KEY || '').trim() : '')
  );
  const rawUrl =
    settings.openai.apiUrl?.trim() ||
    (fallback ? process.env.OPENAI_URL : undefined);
  const apiUrl = normalizeOpenAiBaseUrl(rawUrl) || DEFAULT_SETTINGS.openai.apiUrl;
  return { apiKey, apiUrl };
}

function applySettingsFallbackFromEnv(settings: AppSettings): AppSettings {
  if (!isSettingsFallbackFromEnvEnabled()) return settings;
  const openai = { ...settings.openai };
  const youtube = { ...settings.youtube };
  if (!openai.apiKey.trim() && process.env.OPENAI_API_KEY?.trim()) {
    openai.apiKey = process.env.OPENAI_API_KEY.trim();
  }
  const envBase = normalizeOpenAiBaseUrl(process.env.OPENAI_URL);
  if (!openai.apiUrl.trim()) {
    openai.apiUrl = envBase || DEFAULT_SETTINGS.openai.apiUrl;
  }
  if (!youtube.clientId.trim() && process.env.YT_CLIENT_ID?.trim()) {
    youtube.clientId = process.env.YT_CLIENT_ID.trim();
  }
  if (!youtube.clientSecret.trim() && process.env.YT_CLIENT_SECRET?.trim()) {
    youtube.clientSecret = process.env.YT_CLIENT_SECRET.trim();
  }
  if (!youtube.redirectUri.trim() && process.env.YT_REDIRECT_URI?.trim()) {
    youtube.redirectUri = process.env.YT_REDIRECT_URI.trim();
  }
  if (!youtube.refreshToken.trim() && process.env.YT_REFRESH_TOKEN?.trim()) {
    youtube.refreshToken = process.env.YT_REFRESH_TOKEN.trim();
  }
  const elevenlabs = { ...settings.elevenlabs };
  if (!elevenlabs.apiKey.trim() && process.env.ELEVENLABS_API_KEY?.trim()) {
    elevenlabs.apiKey = process.env.ELEVENLABS_API_KEY.trim();
  }
  if (!elevenlabs.voiceId.trim() && process.env.ELEVENLABS_VOICE_ID?.trim()) {
    elevenlabs.voiceId = process.env.ELEVENLABS_VOICE_ID.trim();
  }
  if (!elevenlabs.modelId.trim() && process.env.ELEVENLABS_MODEL_ID?.trim()) {
    elevenlabs.modelId = process.env.ELEVENLABS_MODEL_ID.trim();
  }
  return { ...settings, openai, youtube, elevenlabs };
}

async function loadSettingsFromDb(userId: string): Promise<AppSettings> {
  try {
    const doc = await UserSettings.findOne({ userId });
    if (doc) {
      if (doc.settingsEnc) {
        const saved = await decryptJson<any>(doc.settingsEnc);
        return deepMerge(DEFAULT_SETTINGS, saved) as AppSettings;
      }
      // Legacy plaintext fallback (migrate lazily on read)
      if (doc.settingsJson) {
        const saved = JSON.parse(doc.settingsJson);
        const merged = deepMerge(DEFAULT_SETTINGS, saved) as AppSettings;
        // Best-effort migration: encrypt settings and clear plaintext.
        // If encryption fails (e.g. missing KMS/APP_ENCRYPTION_KEY), we still return merged.
        try {
          const enc = await encryptJson(merged);
          await UserSettings.updateOne(
            { _id: doc._id },
            { $set: { settingsEnc: enc, schemaVersion: 2 }, $unset: { settingsJson: '' } }
          );
        } catch {
          // ignore
        }
        return merged;
      }
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function loadSettings(userId: string): Promise<AppSettings> {
  const fromDb = await loadSettingsFromDb(userId);
  return applySettingsFallbackFromEnv(fromDb);
}

export async function saveSettings(userId: string, settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettingsFromDb(userId);
  const merged = deepMerge(current, settings) as AppSettings;
  const enc = await encryptJson(merged);
  await UserSettings.findOneAndUpdate({ userId }, { userId, settingsEnc: enc, schemaVersion: 2 }, { upsert: true });
  return applySettingsFallbackFromEnv(merged);
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
