/**
 * GPT-based trailer breakdown script generation.
 */
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import type { BreakdownSegment } from '../../common/db/models/TrailerBreakdownJob.js';

export type TranscriptLine = { start: number; end: number; text: string };
export type SceneWindow = { start: number; end: number; text: string };

export type BreakdownScriptResult = {
  title: string;
  segments: BreakdownSegment[];
};

type GptSegment = {
  startSec?: number;
  endSec?: number;
  label?: string;
  narration?: string;
  onScreenText?: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in AI response');
  }
  return cleaned.slice(start, end + 1);
}

function validateSegments(raw: GptSegment[], durationSec: number): BreakdownSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('AI returned no breakdown segments');
  }

  const segments: BreakdownSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    const startSec = clamp(Number(s.startSec ?? 0), 0, durationSec);
    const endSec = clamp(Number(s.endSec ?? startSec + 3), startSec + 0.5, durationSec);
    const narration = typeof s.narration === 'string' ? s.narration.trim() : '';
    if (!narration) continue;

    segments.push({
      id: `seg-${i + 1}-${randomUUID().slice(0, 8)}`,
      startSec,
      endSec,
      label: typeof s.label === 'string' ? s.label.trim() : `Segment ${i + 1}`,
      narration,
      onScreenText: typeof s.onScreenText === 'string' ? s.onScreenText.trim() : s.label?.trim() || '',
    });
  }

  if (segments.length === 0) {
    throw new Error('AI breakdown segments had no narration text');
  }
  return segments;
}

/**
 * Generate a structured trailer breakdown script from transcript + scene data.
 */
export async function generateTrailerBreakdownScript(params: {
  client: OpenAI;
  movieTitle: string;
  durationSec: number;
  transcript: TranscriptLine[];
  scenes: SceneWindow[];
  model?: string;
}): Promise<BreakdownScriptResult> {
  const { client, movieTitle, durationSec, transcript, scenes, model = 'gpt-4o-mini' } = params;

  const system = `You are an expert movie trailer analyst creating voiceover scripts for YouTube breakdown videos.
Write in a conversational, engaging analysis tone (like Mr. Sunday Movies or ScreenCrush).
Return JSON only.`;

  const user = JSON.stringify({
    movieTitle: movieTitle || 'Unknown title',
    durationSec,
    transcript: transcript.slice(0, 120),
    scenes: scenes.slice(0, 40),
    instructions: [
      'Produce 8–15 segments covering the full trailer chronologically.',
      'First segment: strong hook (≤12 words of narration).',
      'Each segment needs startSec/endSec within [0, durationSec], label, narration (2–4 sentences), onScreenText (short lower-third).',
      'Identify characters, plot hints, visual details, Easter eggs, and fan theories where plausible.',
      'Last segment: brief subscribe/CTA.',
      'Narration must be original analysis — do not just quote trailer dialogue.',
    ],
    schema: {
      title: 'string — breakdown video title',
      segments: [
        {
          startSec: 'number',
          endSec: 'number',
          label: 'string',
          narration: 'string',
          onScreenText: 'string',
        },
      ],
    },
  });

  const res = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
  });

  const rawContent = res.choices[0]?.message?.content || '{}';
  let parsed: { title?: string; segments?: GptSegment[] };
  try {
    parsed = JSON.parse(extractJsonObject(rawContent)) as { title?: string; segments?: GptSegment[] };
  } catch {
    throw new Error('Failed to parse AI breakdown script JSON');
  }

  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : movieTitle
        ? `${movieTitle} — Trailer Breakdown`
        : 'Trailer Breakdown';

  const segments = validateSegments(parsed.segments || [], durationSec);
  return { title, segments };
}
