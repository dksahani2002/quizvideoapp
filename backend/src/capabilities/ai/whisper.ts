import OpenAI from 'openai';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { WhisperSegment, TranscribeVerboseResult } from './types.js';
import { getMediaDurationSec } from '../media/probe.js';

const execAsync = promisify(exec);

type VerboseTranscription = {
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  text?: string;
};

/**
 * Parse cached `video_whisper.json` from disk (resume path).
 *
 * Accepts legacy bare segment arrays or `{ segments, language }` objects.
 */
export function parseStoredVideoWhisper(raw: unknown): TranscribeVerboseResult {
  if (Array.isArray(raw)) {
    return { segments: raw as WhisperSegment[] };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { segments?: WhisperSegment[]; language?: string };
    if (Array.isArray(o.segments)) {
      return { segments: o.segments, language: typeof o.language === 'string' ? o.language : undefined };
    }
  }
  return { segments: [] };
}

/**
 * Transcribe an audio file with Whisper `verbose_json` (timed segments + language).
 *
 * Files longer than ~10 minutes are split with ffmpeg, transcribed per chunk, then merged.
 * Used for source video dialogue and uploaded/TTS narration audio.
 */
export async function transcribeAudioVerbose(client: OpenAI, audioPath: string): Promise<TranscribeVerboseResult> {
  const maxChunkSec = 600;
  const dur = await getMediaDurationSec(audioPath);
  if (dur <= maxChunkSec + 30) {
    const tr = (await client.audio.transcriptions.create({
      file: createReadStream(audioPath) as any,
      model: 'whisper-1',
      response_format: 'verbose_json',
    } as any)) as unknown as VerboseTranscription;
    const lang = typeof tr.language === 'string' ? tr.language : undefined;
    const fromSegs = normalizeWhisperSegments(tr?.segments || []);
    if (fromSegs.length > 0) return { segments: fromSegs, language: lang };
    const flat = (tr?.text || '').trim();
    if (flat) return { segments: [{ start: 0, end: dur, text: flat }], language: lang };
    return { segments: [] };
  }

  const all: WhisperSegment[] = [];
  let language: string | undefined;
  for (let offset = 0; offset < dur; offset += maxChunkSec) {
    const partPath = audioPath.replace(/\.(wav|mp3|m4a)$/i, `_chunk_${offset}.wav`);
    await execAsync(
      `ffmpeg -y -ss ${offset} -i "${audioPath}" -t ${maxChunkSec} -ac 1 -ar 16000 -c:a pcm_s16le "${partPath}"`
    );
    try {
      const tr = (await client.audio.transcriptions.create({
        file: createReadStream(partPath) as any,
        model: 'whisper-1',
        response_format: 'verbose_json',
      } as any)) as unknown as VerboseTranscription;
      if (!language && typeof tr.language === 'string') language = tr.language;
      const fromSegs = normalizeWhisperSegments(tr?.segments || []);
      if (fromSegs.length) {
        all.push(...fromSegs.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })));
      } else if ((tr?.text || '').trim()) {
        all.push({
          start: offset,
          end: Math.min(offset + maxChunkSec, dur),
          text: (tr as VerboseTranscription).text!.trim(),
        });
      }
    } finally {
      await fs.unlink(partPath).catch(() => {});
    }
  }
  return { segments: mergeAdjacentSegments(all), language };
}

function normalizeWhisperSegments(
  segments: Array<{ start: number; end: number; text?: string }>
): WhisperSegment[] {
  return segments
    .map((s) => ({
      start: s.start,
      end: s.end,
      text: (s.text || '').trim(),
    }))
    .filter((s) => s.text.length > 0);
}

function mergeAdjacentSegments(segments: WhisperSegment[]): WhisperSegment[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out: WhisperSegment[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end + 0.25) {
      cur.end = Math.max(cur.end, n.end);
      cur.text = `${cur.text} ${n.text}`.trim();
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}
