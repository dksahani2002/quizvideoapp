/**
 * GPT-based translation for story editor text.
 *
 * Batches scene labels and narration lines to English when `translateToEnglish` is enabled.
 * Caller: pipeline/run.ts (`applyEnglishTranslationIfNeeded`).
 */
import OpenAI from 'openai';

const CHUNK = 48;

/**
 * Translate many short lines to English in batches (scene labels or narration).
 *
 * Preserves array length; falls back to the original line on parse/API failure.
 *
 * @param context — `video_scenes` uses dialogue tone; `narration` uses voiceover tone
 */
export async function translateLinesToEnglish(
  client: OpenAI,
  lines: string[],
  context: 'video_scenes' | 'narration'
): Promise<string[]> {
  if (lines.length === 0) return [];
  const out: string[] = new Array(lines.length);
  for (let offset = 0; offset < lines.length; offset += CHUNK) {
    const slice = lines.slice(offset, offset + CHUNK);
    const translated = await translateChunk(client, slice, context);
    for (let i = 0; i < slice.length; i++) {
      out[offset + i] = translated[i] ?? slice[i];
    }
  }
  return out;
}

async function translateChunk(
  client: OpenAI,
  lines: string[],
  context: 'video_scenes' | 'narration'
): Promise<string[]> {
  const system =
    context === 'video_scenes'
      ? 'You translate short on-screen dialogue or scene description lines to natural English. Return JSON only.'
      : 'You translate short narration lines to natural English. Return JSON only.';
  const user = JSON.stringify({
    context,
    lines,
    instruction: 'Return {"lines":[...]} with the same length as input.lines, each string in English.',
  });
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const raw = res.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw) as { lines?: string[] };
    const t = parsed.lines;
    if (Array.isArray(t) && t.length === lines.length) {
      return t.map((s, i) => (typeof s === 'string' && s.trim() ? s.trim() : lines[i]));
    }
  } catch {
    /* fall through */
  }
  return [...lines];
}
