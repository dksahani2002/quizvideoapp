/**
 * Pair narration lines with video scenes for clip assembly.
 *
 * Two strategies:
 *   - {@link matchNarrationToScenesByEmbeddings} — semantic match (same language)
 *   - {@link matchNarrationToScenesSequential} — even spread (narration ≠ video language)
 *
 * Caller: pipeline/run.ts (controlled by `narrationSceneMatchMode` option).
 */
import OpenAI from 'openai';
import { embedTexts, cosineSimilarity } from '../ai/openaiStory.js';

/**
 * Map each narration segment to a scene by spreading indices along the timeline.
 *
 * Use when narration language ≠ video dialogue (embeddings cannot align meaning).
 */
export function matchNarrationToScenesSequential(narrationCount: number, sceneCount: number): number[] {
  if (sceneCount <= 0 || narrationCount <= 0) return [];
  const last = sceneCount - 1;
  if (narrationCount === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < narrationCount; i++) {
    const j = Math.round((i * last) / (narrationCount - 1));
    out.push(Math.min(last, Math.max(0, j)));
  }
  return out;
}

/**
 * Match each narration line to the most similar scene by OpenAI text embeddings.
 *
 * Returns scene indices (one per narration segment). Best when narration and scene text
 * share a language or were translated to English first.
 */
export async function matchNarrationToScenesByEmbeddings(
  openai: OpenAI,
  narrTexts: string[],
  sceneTexts: string[]
): Promise<number[]> {
  const [narrEmb, sceneEmb] = await Promise.all([
    embedTexts(openai, narrTexts),
    embedTexts(openai, sceneTexts),
  ]);
  const matches: number[] = [];
  for (let i = 0; i < narrEmb.length; i++) {
    let bestJ = 0;
    let best = -1;
    for (let j = 0; j < sceneEmb.length; j++) {
      const c = cosineSimilarity(narrEmb[i], sceneEmb[j]);
      if (c > best) {
        best = c;
        bestJ = j;
      }
    }
    matches.push(bestJ);
  }
  return matches;
}
