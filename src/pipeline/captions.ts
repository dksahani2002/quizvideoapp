import fs from 'fs/promises';
import path from 'path';
import type { SegmentMetadata } from '../types/index.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(msRem).padStart(3, '0')}`;
}

function toVttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(msRem).padStart(3, '0')}`;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Build lightweight captions from segment metadata component durations.
 * These are intended for Shorts/Reels accessibility, not word-level karaoke.
 */
export function buildCues(
  segments: SegmentMetadata[],
  opts?: { includeAnswers?: boolean }
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let t = 0;
  for (const seg of segments.filter(s => s.status === 'muxed')) {
    const cd = seg.componentDurations;
    if (!cd) {
      // Fallback: single cue for the whole segment.
      cues.push({
        start: t,
        end: t + (seg.finalDuration || seg.audioDuration || 0),
        text: `${seg.quiz.question}`,
      });
      t += seg.finalDuration || seg.audioDuration || 0;
      continue;
    }
    const qStart = t;
    const qEnd = qStart + cd.question;
    cues.push({ start: qStart, end: qEnd, text: seg.quiz.question });
    let oT = qEnd;
    for (let i = 0; i < 4; i++) {
      const oEnd = oT + (cd.options?.[i] || 0);
      const label = ['A', 'B', 'C', 'D'][i];
      cues.push({ start: oT, end: oEnd, text: `${label}) ${seg.quiz.options[i]}` });
      oT = oEnd;
    }
    const ansStart = oT + (cd.countdown || 0);
    if (opts?.includeAnswers !== false) {
      const ansEnd = ansStart + (cd.answer || 0);
      const correct = ['A', 'B', 'C', 'D'][seg.quiz.answerIndex] || 'A';
      cues.push({ start: ansStart, end: ansEnd, text: `Answer: ${correct}` });
    }
    t += seg.finalDuration || seg.audioDuration || 0;
  }
  return cues.filter(c => c.end > c.start + 0.05 && c.text.trim().length > 0);
}

export async function writeSrtAndVtt(
  outputVideoPath: string,
  cues: CaptionCue[]
): Promise<{ srtPath: string; vttPath: string }> {
  const dir = path.dirname(outputVideoPath);
  const base = path.basename(outputVideoPath, path.extname(outputVideoPath));
  const srtPath = path.join(dir, `${base}.srt`);
  const vttPath = path.join(dir, `${base}.vtt`);

  const srt = cues
    .map((c, idx) => `${idx + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}\n`)
    .join('\n');
  const vtt = ['WEBVTT', '', ...cues.map((c) => `${toVttTime(c.start)} --> ${toVttTime(c.end)}\n${c.text}\n`)].join('\n');

  await fs.writeFile(srtPath, srt, 'utf8');
  await fs.writeFile(vttPath, vtt, 'utf8');
  return { srtPath, vttPath };
}

