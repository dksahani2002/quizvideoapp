/**
 * Align user script text to Whisper timings from uploaded narration audio.
 *
 * Splits the script proportionally by word count across Whisper segments so editor text
 * matches recorded audio duration. Caller: pipeline/run.ts (script + audio path).
 */
import type { WhisperSegment } from '../lib/types.js';
import type { NarrationSegment } from '../lib/types.js';

/** Split `text` into `n` contiguous chunks by word count (proportional). */
export function proportionalWordSplit(text: string, n: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (n <= 0) return [];
  if (n === 1) return [words.join(' ')];
  if (words.length === 0) return Array.from({ length: n }, () => '');
  if (words.length <= n) {
    return Array.from({ length: n }, (_, i) => words[i] || '');
  }
  const out: string[] = [];
  const base = Math.floor(words.length / n);
  let rem = words.length % n;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const take = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push(words.slice(idx, idx + take).join(' '));
    idx += take;
  }
  return out;
}

/**
 * When both script and narration audio exist: keep Whisper timings, override text with proportional script slices.
 */
export function alignScriptToWhisperTimings(script: string, whisper: WhisperSegment[]): NarrationSegment[] {
  if (whisper.length === 0) return [];
  const parts = proportionalWordSplit(script, whisper.length);
  return whisper.map((w, i) => ({
    index: i,
    text: (parts[i] || w.text || '').trim() || w.text,
    startSec: w.start,
    endSec: w.end,
  }));
}
