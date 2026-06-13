import { createTTSService } from '../../common/services/ttsService.js';
import { resolveOpenAiCredentials, type AppSettings } from '../../common/services/settingsService.js';
import type { GenerateRequestPayload } from './types.js';

export type TtsKind = 'system' | 'openai' | 'elevenlabs';

export type ResolvedTts = {
  provider: TtsKind;
  voice: string | undefined;
  ttsModel: string;
  elevenlabsModelId: string;
  openaiKey: string;
};

/**
 * Initial provider + voice from request and saved settings (before platform fallback).
 */
export function resolveTtsFromRequest(req: GenerateRequestPayload, settings: AppSettings): ResolvedTts {
  const provider: TtsKind = req.ttsProvider || settings.tts.provider || 'system';
  const voiceFromReq = req.ttsVoice?.trim();
  const systemVoice = req.systemVoice?.trim();
  const voice =
    provider === 'elevenlabs'
      ? voiceFromReq || settings.elevenlabs.voiceId
      : provider === 'openai'
        ? voiceFromReq || settings.tts.voice
        : systemVoice || settings.tts.voice;

  const ttsModel = req.ttsModel?.trim() || 'tts-1';
  const elevenlabsModelId = req.elevenlabsModelId?.trim() || settings.elevenlabs.modelId || 'eleven_turbo_v2_5';
  const openaiKey = settings.openai.apiKey?.trim() || '';

  return {
    provider,
    voice,
    ttsModel,
    elevenlabsModelId,
    openaiKey,
  };
}

/**
 * On non-macOS hosts, `system` TTS (`say`) is unavailable — fall back to OpenAI or ElevenLabs when configured.
 */
export function applyServerTtsFallback(resolved: ResolvedTts, settings: AppSettings): ResolvedTts {
  if (resolved.provider !== 'system' || process.platform === 'darwin') {
    return resolved;
  }
  if (resolved.openaiKey) {
    return { ...resolved, provider: 'openai' };
  }
  if (settings.elevenlabs.apiKey?.trim()) {
    return { ...resolved, provider: 'elevenlabs' };
  }
  throw new Error(
    'System TTS is not available on this server. Configure OpenAI or ElevenLabs TTS in Settings before rendering.'
  );
}

export function createIntroOutroTtsService(
  resolved: ResolvedTts,
  settings: AppSettings,
  introOutroCacheDir: string
) {
  const creds = resolveOpenAiCredentials(settings);
  return createTTSService(resolved.provider, {
    apiKey: creds.apiKey || resolved.openaiKey,
    model: resolved.ttsModel,
    cacheDir: introOutroCacheDir,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolved.elevenlabsModelId,
    openaiApiUrl: creds.apiUrl,
  });
}
