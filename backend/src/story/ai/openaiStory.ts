/**
 * OpenAI helpers for the story-video pipeline.
 *
 * Most primitives live in capabilities/ai; this module retains scene-window
 * assignment until Phase 3 of the capabilities refactor.
 */
import type { WhisperSegment } from '../../capabilities/ai/types.js';

export {
  createOpenAIClient,
  transcribeAudioVerbose,
  parseStoredVideoWhisper,
  embedTexts,
  cosineSimilarity,
} from '../../capabilities/ai/index.js';
export type { TranscribeVerboseResult } from '../../capabilities/ai/index.js';

/**
 * Attach Whisper dialogue text to each detected scene window by time overlap.
 *
 * Called after scene detection; fills `scenes.json` text fields (placeholder if no overlap).
 */
export function assignWhisperToSceneWindows(
  windows: Array<{ start: number; end: number }>,
  whisper: WhisperSegment[]
): Array<{ index: number; start: number; end: number; text: string }> {
  return windows.map((win, index) => {
    const overlap = whisper.filter((s) => s.start < win.end && s.end > win.start);
    const text = overlap
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      index,
      start: win.start,
      end: win.end,
      text: text || `[scene ${index + 1}]`,
    };
  });
}
