export interface Quiz {
  question: string;
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
}

export interface VideoItem {
  id: string;
  jobId: string;
  filename: string;
  url: string;
  size: number;
  status: 'generating' | 'completed' | 'failed';
  lastError?: string;
  attempts?: number;
  progressStage?: string;
  progressMessage?: string;
  createdAt: string;
}

export interface ThemeConfig {
  preset: string;
  customStops: Array<{ pos: number; color: string }>;
  backgroundImage: string;
  backgroundOpacity: number;
  textAlign: 'left' | 'center' | 'right';
  fontSize: 'small' | 'medium' | 'large';
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
}

export interface AppSettings {
  openai: { apiKey: string; apiUrl: string };
  tts: { provider: 'system' | 'openai' | 'elevenlabs'; voice: string };
  elevenlabs: { apiKey: string; voiceId: string; voiceName: string; modelId: string };
  youtube: { clientId: string; clientSecret: string; redirectUri: string; refreshToken: string };
  instagramGraph: { pageId: string; igUserId: string; accessToken: string; tokenExpiresAt: string };
  brand: {
    introScript: string;
    outroScript: string;
    ctaLine: string;
    watermarkImage: string;
    watermarkOpacity: number;
    watermarkPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  theme: ThemeConfig;
}

export interface GenerateRequest {
  topic: string;
  questionCount: number;
  mcqSource: 'openai' | 'manual';
  manualQuizzes?: Quiz[];
  ttsProvider: 'system' | 'openai' | 'elevenlabs';
  theme?: Partial<ThemeConfig>;
  textAlign?: 'left' | 'center' | 'right';
  /** Quiz copy language (AI topic mode). */
  language?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  tone?: 'neutral' | 'professional' | 'friendly' | 'exam' | 'witty';
  audience?: string;
  customInstructions?: string;
  /** Chat model for MCQ generation, e.g. gpt-4o-mini */
  openaiModel?: string;
  /** 0.75–1.25 — scales on-screen text size */
  layoutDensity?: number;
  /** Short label in the top bar (default QUIZ) */
  headerTitle?: string;
  /** OpenAI TTS voice id */
  ttsVoice?: string;
  /** OpenAI TTS model: tts-1 | tts-1-hd */
  ttsModel?: string;
  /** macOS `say -v` voice name when using system TTS */
  systemVoice?: string;
  /** Override ElevenLabs model for this render */
  elevenlabsModelId?: string;

  // Brand kit overrides
  introScript?: string;
  outroScript?: string;
  ctaLine?: string;
  captionsBurnIn?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
}
