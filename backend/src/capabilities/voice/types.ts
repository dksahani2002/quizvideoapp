export type TtsProvider = 'system' | 'openai' | 'elevenlabs';
export type TtsOverride = 'inherit' | TtsProvider;

export type VoiceOverrides = {
  ttsProvider?: TtsProvider | TtsOverride;
  ttsVoice?: string;
  ttsModel?: string;
  systemVoice?: string;
  elevenlabsModelId?: string;
};

export type ResolvedTts = {
  provider: TtsProvider;
  voice: string | undefined;
  ttsModel: string;
  elevenlabsModelId: string;
  openaiKey: string;
};
