import { UserSettings } from '../db/models/UserSettings.js';
import { decryptJson, encryptJson } from './cryptoService.js';
import { BRAND_DEFAULTS_EN } from '../utils/quizUiStrings.js';

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

export async function loadSettings(userId: string): Promise<AppSettings> {
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

export async function saveSettings(userId: string, settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings(userId);
  const merged = deepMerge(current, settings) as AppSettings;
  const enc = await encryptJson(merged);
  await UserSettings.findOneAndUpdate({ userId }, { userId, settingsEnc: enc, schemaVersion: 2 }, { upsert: true });
  return merged;
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
