import type { WhisperSegment } from '../ai/types.js';

/** Build non-overlapping scene windows from cut times + duration. Caps segment count for very long files. */
export function buildSceneWindows(
  durationSec: number,
  cutTimes: number[],
  opts?: { maxScenes?: number; minSceneSec?: number }
): Array<{ start: number; end: number }> {
  const maxScenes = opts?.maxScenes ?? 400;
  const minScene = opts?.minSceneSec ?? 0.5;
  let cuts = [...new Set(cutTimes.filter((t) => t > 0 && t < durationSec))].sort((a, b) => a - b);
  if (cuts.length > maxScenes - 1) {
    const step = Math.ceil(cuts.length / (maxScenes - 1));
    cuts = cuts.filter((_, i) => i % step === 0);
  }
  const points = [0, ...cuts, durationSec];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end - start >= minScene) out.push({ start, end });
  }
  if (out.length === 0) {
    const step = Math.min(30, Math.max(5, durationSec / 20));
    for (let t = 0; t < durationSec; t += step) {
      out.push({ start: t, end: Math.min(durationSec, t + step) });
    }
  }
  return out;
}

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
