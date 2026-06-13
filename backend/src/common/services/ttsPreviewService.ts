import path from 'path';
import fs from 'fs/promises';
import { loadEnvConfig } from '../config/envConfig.js';
import { loadSettings } from './settingsService.js';
import { createTTSService } from './ttsService.js';
import { normalizeQuizLanguage } from '../i18n/quizLanguages.js';

const PREVIEW_MAX_CHARS = 500;

export type TtsPreviewResult =
  | { kind: 'ok'; buffer: Buffer }
  | { kind: 'bad_request'; error: string }
  | { kind: 'error'; error: string };

export async function generateTtsPreview(userId: string, body: any): Promise<TtsPreviewResult> {
  try {
    const env = loadEnvConfig();
    const {
      text,
      ttsProvider: rawProvider,
      ttsVoice,
      ttsModel,
      systemVoice,
      elevenlabsModelId,
      language: rawLang,
    } = body;

    const sample =
      typeof text === 'string' && text.trim().length > 0
        ? text.trim().slice(0, PREVIEW_MAX_CHARS)
        : 'This is a short voice preview for your quiz video.';

    const settings = await loadSettings(userId);
    const tts = (rawProvider || settings.tts.provider || 'system') as 'openai' | 'system' | 'elevenlabs';

    if (tts === 'system' && process.platform !== 'darwin') {
      return {
        kind: 'bad_request',
        error: 'System TTS is not available on this server. Choose OpenAI or ElevenLabs in Settings.',
      };
    }

    const openaiKey = (settings.openai.apiKey || '').trim();
    const openaiUrl = settings.openai.apiUrl || 'https://api.openai.com/v1';

    let voice: string | undefined;
    if (tts === 'elevenlabs') {
      voice = (typeof ttsVoice === 'string' ? ttsVoice : undefined)?.trim() || settings.elevenlabs.voiceId;
    } else if (tts === 'openai') {
      voice = (typeof ttsVoice === 'string' ? ttsVoice : undefined)?.trim() || 'alloy';
    } else {
      voice = (typeof systemVoice === 'string' ? systemVoice : undefined)?.trim() || settings.tts.voice || 'Alex';
    }

    if (tts === 'openai' && !openaiKey) {
      return { kind: 'bad_request', error: 'OpenAI API key required. Add it in Settings.' };
    }
    if (tts === 'elevenlabs' && !settings.elevenlabs.apiKey?.trim()) {
      return { kind: 'bad_request', error: 'ElevenLabs API key required in Settings.' };
    }

    const model = typeof ttsModel === 'string' ? ttsModel.trim() : 'tts-1';
    const elModel =
      (typeof elevenlabsModelId === 'string' ? elevenlabsModelId.trim() : '') ||
      settings.elevenlabs.modelId ||
      'eleven_turbo_v2_5';

    const ttsService = createTTSService(tts, {
      apiKey: openaiKey,
      model,
      cacheDir: path.join(env.CACHE_DIR, 'tts-preview'),
      openaiApiUrl: openaiUrl,
      elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
      elevenlabsModelId: elModel,
    });

    const previewLang = normalizeQuizLanguage(rawLang);
    const audioPath = await ttsService.generate(sample, previewLang, voice);
    const buffer = await fs.readFile(audioPath);
    return { kind: 'ok', buffer };
  } catch (err: any) {
    console.error('TTS preview failed:', err?.message || err);
    return { kind: 'error', error: err?.message || 'Failed to generate preview' };
  }
}
