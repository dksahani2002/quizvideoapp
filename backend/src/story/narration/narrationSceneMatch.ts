/**
 * Pair narration lines with video scenes for clip assembly.
 *
 * Two strategies:
 *   - {@link matchNarrationToScenesByEmbeddings} — semantic + time-aware match (same language)
 *   - {@link matchNarrationToScenesSequential} — even spread (narration ≠ video language)
 *
 * Caller: pipeline/run.ts (controlled by `narrationSceneMatchMode` option).
 */
import OpenAI from 'openai';
import { embedTexts, cosineSimilarity } from '../../capabilities/ai/index.js';

export type SceneMatchInput = {
  start: number;
  end: number;
  text: string;
};

export type NarrationMatchInput = {
  text: string;
  startSec?: number;
  endSec?: number;
};

/** True when scene dialogue could not be transcribed (no Whisper overlap in that window). */
export function isPlaceholderSceneText(text: string): boolean {
  const t = text.trim();
  return /^\[scene\s+\d+\]$/i.test(t) || t.length === 0;
}

/**
 * Map each narration segment to a scene by spreading indices along the timeline.
 *
 * Use when narration language ≠ video dialogue (embeddings cannot align meaning).
 */
export function matchNarrationToScenesSequential(narrationCount: number, sceneCount: number): number[] {
  if (sceneCount <= 0 || narrationCount <= 0) return [];
  const last = sceneCount - 1;
  if (narrationCount === 1) return [Math.min(last, Math.floor(sceneCount / 2))];
  const out: number[] = [];
  for (let i = 0; i < narrationCount; i++) {
    const j = Math.round((i * last) / (narrationCount - 1));
    out.push(Math.min(last, Math.max(0, j)));
  }
  return out;
}

function narrationTargetTimesSec(
  narration: NarrationMatchInput[],
  videoDurationSec: number
): number[] {
  const n = narration.length;
  if (n === 0) return [];
  const hasTiming = narration.every((seg) => seg.startSec != null && seg.endSec != null);
  if (hasTiming) {
    const starts = narration.map((seg) => seg.startSec!);
    const ends = narration.map((seg) => seg.endSec!);
    const span = Math.max(0.5, Math.max(...ends) - Math.min(...starts));
    const base = Math.min(...starts);
    return narration.map((seg) => {
      const mid = ((seg.startSec ?? base) + (seg.endSec ?? base)) / 2;
      const rel = (mid - base) / span;
      return Math.min(videoDurationSec, Math.max(0, rel * videoDurationSec));
    });
  }
  if (n === 1) return [videoDurationSec / 2];
  return narration.map((_, i) => (i / (n - 1)) * videoDurationSec);
}

function temporalScore(sceneMidSec: number, targetSec: number, sigmaSec: number): number {
  if (sigmaSec <= 0) return 0;
  const d = sceneMidSec - targetSec;
  return Math.exp(-(d * d) / (2 * sigmaSec * sigmaSec));
}

/**
 * Match each narration line to a scene using embeddings plus a timeline prior.
 *
 * Pure embedding match collapses to the first dialogue-heavy scenes because:
 *   - Scene text comes from Whisper on the video track (silent scenes → `[scene N]` placeholders)
 *   - The same scene index can be reused for every narration line
 *
 * This blend prefers scenes near the narration's proportional position on the timeline while
 * still rewarding semantic similarity where dialogue exists.
 */
export async function matchNarrationToScenesByEmbeddings(
  openai: OpenAI,
  narration: NarrationMatchInput[],
  scenes: SceneMatchInput[],
  videoDurationSec: number
): Promise<number[]> {
  if (scenes.length === 0 || narration.length === 0) return [];

  const narrTexts = narration.map((n) => n.text);
  const sceneTexts = scenes.map((s) => (isPlaceholderSceneText(s.text) ? ' ' : s.text));
  const [narrEmb, sceneEmb] = await Promise.all([
    embedTexts(openai, narrTexts),
    embedTexts(openai, sceneTexts),
  ]);

  const sceneMids = scenes.map((s) => (s.start + s.end) / 2);
  const targets = narrationTargetTimesSec(narration, videoDurationSec);
  const sigmaSec = Math.max(15, videoDurationSec * 0.12);

  const EMB_WEIGHT = 0.5;
  const TIME_WEIGHT = 0.5;
  const REUSE_PENALTY = 0.4;

  const matches: number[] = [];
  const useCount = new Array(scenes.length).fill(0);

  for (let i = 0; i < narrEmb.length; i++) {
    let bestJ = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < sceneEmb.length; j++) {
      const placeholder = isPlaceholderSceneText(scenes[j].text);
      const emb = placeholder ? 0 : cosineSimilarity(narrEmb[i], sceneEmb[j]);
      const time = temporalScore(sceneMids[j], targets[i], sigmaSec);
      const blend = placeholder
        ? time
        : EMB_WEIGHT * emb + TIME_WEIGHT * time;
      const penalty = useCount[j] * REUSE_PENALTY;
      const score = blend - penalty;
      if (score > bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }
    matches.push(bestJ);
    useCount[bestJ] += 1;
  }
  return matches;
}
