import type { Quiz, VideoTheme } from '../../common/types/index.js';
import type { MCQ } from '../agents/mcqAgent.js';

/**
 * Parsed `Video.requestJson` for quiz video generation.
 * Kept here so API routes and the job runner share one conceptual shape.
 */
export type GenerateRequestPayload = {
  topic: string;
  questionCount: number;
  mcqSource: 'openai' | 'manual';
  manualQuizzes?: MCQ[];
  /** Resolved quizzes (required for rendering; set for both AI and manual flows). */
  quizzes?: Quiz[];
  ttsProvider: 'system' | 'openai' | 'elevenlabs';
  theme?: unknown;
  textAlign?: unknown;
  language?: string;
  difficulty?: string;
  tone?: string;
  audience?: string;
  customInstructions?: string;
  openaiModel?: string;
  layoutDensity?: number;
  headerTitle?: string;
  ttsVoice?: string;
  ttsModel?: string;
  systemVoice?: string;
  elevenlabsModelId?: string;
  introScript?: string;
  outroScript?: string;
  ctaLine?: string;
  captionsBurnIn?: boolean;
  introTheme?: VideoTheme;
  outroTheme?: VideoTheme;
};
