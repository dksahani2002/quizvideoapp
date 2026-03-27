/**
 * Core data structures for the quiz video rendering pipeline
 */

export interface Quiz {
  question: string;
  options: [string, string, string, string]; // Exactly 4 options
  answerIndex: 0 | 1 | 2 | 3;
  language?: string; // ISO 639-1 code (default: 'en')
}

export interface SegmentMetadata {
  segmentId: string;
  quiz: Quiz;
  
  // Audio phase
  audioFiles: {
    question: string;
    options: [string, string, string, string];
    countdown: string;
    answer: string;
  };
  audioConcatFile: string;
  audioDuration: number; // Extracted via FFprobe (seconds)
  componentDurations?: {
    question: number;
    options: [number, number, number, number];
    countdown: number;
    answer: number;
  };
  
  // Video phase
  videoFile: string;
  videoDuration: number; // audioDuration + safetyPadding
  
  // Muxed phase
  muxedFile: string;
  finalDuration: number; // Should ≈ audioDuration
  
  // Status tracking
  status: 'pending' | 'audio' | 'video' | 'muxed' | 'failed';
  error?: string;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
}

export interface RenderConfig {
  // Video specs
  width: number;        // 1080
  height: number;       // 1920
  fps: number;          // 30
  codec: string;        // 'libx264'
  
  // Audio specs
  sampleRate: number;   // 44100
  channels: number;     // 2 (stereo)
  loudnessTarget: number; // -23 (EBU R128 LUFS)
  
  // Timing
  safetyPadding: number; // 0.2 seconds
  minSegmentDuration: number; // 1.2 seconds
  maxAnimationTime: number; // Clamp animations to audio duration
  
  // Text rendering
  maxLineLength: number; // 50 characters
  safeMargin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  fontFile: string;     // Preloaded font path
  
  // TTS
  ttsProvider: 'openai' | 'system' | 'elevenlabs';
  ttsVoice?: string;
  ttsModel?: string;
  
  // Concurrency
  maxConcurrentSegments: number; // 3
  
  // Paths
  tempDir: string;
  outputDir: string;
  cacheDir: string;
  
  // Intro/Outro
  introVideo?: string;
  outroVideo?: string;
  
  // Background music & SFX
  bgmFile?: string;
  sfxTickFile?: string;
  sfxDingFile?: string;
  sfxCountdownTickFile?: string;
  bgmVolume?: number; // 0-1, default 0.12

  // Theme customization
  theme?: {
    preset?: string;
    customStops?: Array<{ pos: number; color: string }>;
    backgroundImage?: string;
    backgroundOpacity?: number;
  };
  textAlign?: 'left' | 'center' | 'right';

  /** Multiplier for base font sizes (0.75–1.25). Higher = larger text, tighter fit risk. */
  layoutDensity?: number;
  /** Replaces the default "QUIZ" header label (short branding). */
  headerTitle?: string;

  // Captions/subtitles
  captions?: {
    /** Generate subtitle sidecars (SRT/VTT). */
    enabled?: boolean;
    /** Burn-in subtitles into the final MP4 (slower, but universal). */
    burnIn?: boolean;
  };

  // Brand watermark
  watermark?: {
    imagePath?: string;
    opacity?: number; // 0-1
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };

  /** When using OpenAI TTS, optional base URL (e.g. same as chat completions). */
  openaiApiUrl?: string;
  /** API key for OpenAI TTS when not relying on process.env. */
  openaiApiKey?: string;

  // Post-processing
  maxTotalDuration: number; // 60 seconds
  speedUpIfExceeds: boolean; // true
}

export interface TTSRequest {
  text: string;
  language: string;
  voice?: string;
}

export interface FFprobeDuration {
  duration: number; // in seconds
  error?: string;
}

export interface ConcatSegment {
  file: string;
  duration: number;
}
