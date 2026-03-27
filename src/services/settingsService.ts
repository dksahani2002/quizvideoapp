import { UserSettings } from '../db/models/UserSettings.js';

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
  instagram: {
    username: string;
    password: string;
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
  instagram: { username: '', password: '' },
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
      const saved = JSON.parse(doc.settingsJson);
      return deepMerge(DEFAULT_SETTINGS, saved) as AppSettings;
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(userId: string, settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings(userId);
  const merged = deepMerge(current, settings) as AppSettings;
  await UserSettings.findOneAndUpdate(
    { userId },
    { userId, settingsJson: JSON.stringify(merged) },
    { upsert: true }
  );
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
