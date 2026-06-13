/**
 * OpenAI helpers for the story-video pipeline.
 *
 * Primitives live in capabilities/ai; this module re-exports them for story callers.
 */
export {
  createOpenAIClient,
  transcribeAudioVerbose,
  parseStoredVideoWhisper,
  embedTexts,
  cosineSimilarity,
} from '../../capabilities/ai/index.js';
export type { TranscribeVerboseResult } from '../../capabilities/ai/index.js';
