export type VoiceProvider = 'inherit' | 'openai' | 'elevenlabs' | 'system';

export type VoiceOptions = {
  ttsProvider: VoiceProvider;
  ttsVoice: string;
  ttsModel: 'tts-1' | 'tts-1-hd';
  systemVoice: string;
  elevenlabsModelId: string;
  narrationLanguage: string;
};
