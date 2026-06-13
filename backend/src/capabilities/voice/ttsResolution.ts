import type { AppSettings } from '../../common/services/settingsService.js';
import type { GenerateRequestPayload } from '../../mcq/videoJob/types.js';
import type { ResolvedTts, VoiceOverrides, TtsProvider } from './types.js';

export function resolveTtsFromSettings(
  settings: AppSettings,
  overrides: VoiceOverrides = {}
): ResolvedTts {
  const inherit = overrides.ttsProvider === 'inherit' || overrides.ttsProvider === undefined;
  const provider: TtsProvider = inherit
    ? (settings.tts.provider as TtsProvider) || 'system'
    : (overrides.ttsProvider as TtsProvider);

  const voiceFromOverride = overrides.ttsVoice?.trim();
  const systemVoice = overrides.systemVoice?.trim();
  const voice =
    provider === 'elevenlabs'
      ? voiceFromOverride || settings.elevenlabs.voiceId
      : provider === 'openai'
        ? voiceFromOverride || settings.tts.voice
        : systemVoice || settings.tts.voice;

  const ttsModel = overrides.ttsModel?.trim() || 'tts-1';
  const elevenlabsModelId =
    overrides.elevenlabsModelId?.trim() || settings.elevenlabs.modelId || 'eleven_turbo_v2_5';
  const openaiKey = settings.openai.apiKey?.trim() || '';

  return { provider, voice, ttsModel, elevenlabsModelId, openaiKey };
}

/** MCQ generate-video request shape — keep for mcq vertical */
export function resolveTtsFromRequest(req: GenerateRequestPayload, settings: AppSettings): ResolvedTts {
  return resolveTtsFromSettings(settings, {
    ttsProvider: req.ttsProvider,
    ttsVoice: req.ttsVoice,
    ttsModel: req.ttsModel,
    systemVoice: req.systemVoice,
    elevenlabsModelId: req.elevenlabsModelId,
  });
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
