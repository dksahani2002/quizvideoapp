/**
 * Narration segment builders and duration heuristics.
 *
 * Converts script text, Whisper output, or TTS timings into {@link NarrationSegment} arrays
 * used by the pipeline and timeline editor.
 *
 * Callers: pipeline/run.ts, pipeline/narrationRerender.ts
 */
import type { NarrationSegment, WhisperSegment } from '../lib/types.js';

/**
 * Split a narration script into sentence/paragraph segments (no timings yet).
 *
 * Use when the user provides `scriptText` without audio; timings come from TTS or estimates.
 */
export function segmentScriptToNarration(script: string): NarrationSegment[] {
  const raw = script
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.map((text, index) => ({
    index,
    text,
    startSec: undefined,
    endSec: undefined,
  }));
}

/** Heuristic duration (seconds) for script-only segments when no audio timings exist. */
export function estimatedDurationSec(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(45, Math.max(2, words * 0.42));
}

/** Map Whisper segments directly to narration segments (uploaded narration audio path). */
export function narrationFromWhisper(segments: WhisperSegment[]): NarrationSegment[] {
  return segments.map((s, index) => ({
    index,
    text: s.text,
    startSec: s.start,
    endSec: s.end,
  }));
}
