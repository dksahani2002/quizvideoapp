import type { TrailerJobOptions } from '../api';
import { VoiceSettingsPanel } from '../../../shared/voice/VoiceSettingsPanel';

type Props = {
  options: TrailerJobOptions;
  onChange: (next: TrailerJobOptions) => void;
  disabled?: boolean;
};

export function TrailerVoiceSettings({ options, onChange, disabled }: Props) {
  const voiceValue = {
    ttsProvider: options.ttsProvider,
    ttsVoice: options.ttsVoice,
    ttsModel: (options.ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1') as 'tts-1' | 'tts-1-hd',
    systemVoice: options.systemVoice,
    elevenlabsModelId: options.elevenlabsModelId,
    narrationLanguage: options.narrationLanguage,
  };

  return (
    <VoiceSettingsPanel
      value={voiceValue}
      onChange={(voice) => onChange({ ...options, ...voice })}
      disabled={disabled}
      allowInherit
      showNarrationLanguage
      previewText="This is a preview of the breakdown voiceover."
    />
  );
}

export const DEFAULT_TRAILER_OPTIONS: TrailerJobOptions = {
  ttsProvider: 'inherit',
  ttsVoice: '',
  ttsModel: 'tts-1',
  systemVoice: '',
  elevenlabsModelId: '',
  narrationLanguage: 'en',
  exportPreset: 'balanced',
  sceneDetectionMode: 'ffmpeg',
  ffmpegSceneThreshold: 0.32,
};
