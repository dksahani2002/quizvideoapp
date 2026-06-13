import { createTTSService, type TTSService } from '../../common/services/ttsService.js';
import { resolveOpenAiCredentials, type AppSettings } from '../../common/services/settingsService.js';
import { resolveTtsFromSettings, applyServerTtsFallback } from './ttsResolution.js';
import type { ResolvedTts, VoiceOverrides } from './types.js';

export function resolveTtsForJob(settings: AppSettings, overrides: VoiceOverrides): ResolvedTts {
  const base = resolveTtsFromSettings(settings, overrides);
  return applyServerTtsFallback(base, settings);
}

export function createTtsFromSettings(
  settings: AppSettings,
  cacheDir: string,
  overrides: VoiceOverrides = {}
): { tts: TTSService; resolved: ResolvedTts } {
  const resolved = resolveTtsForJob(settings, overrides);
  const creds = resolveOpenAiCredentials(settings);
  const tts = createTTSService(resolved.provider, {
    apiKey: creds.apiKey || resolved.openaiKey,
    model: resolved.ttsModel,
    cacheDir,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolved.elevenlabsModelId,
    openaiApiUrl: creds.apiUrl,
  });
  return { tts, resolved };
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
