/**
 * Subtitle (SRT) generation from timeline clips.
 *
 * Computes program-timeline duration per clip and emits contiguous SRT blocks.
 * Callers: pipeline/finalize.ts, pipeline/narrationRerender.ts (duration helper).
 */
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

const MAX_PROGRAM_CLIP_SEC = 600;

/** Clip duration on the exported program timeline (after trim). */
export function clipOutputDurationSec(c: StoryTimelineClip): number {
  if (
    c.programDurationSec != null &&
    Number.isFinite(c.programDurationSec) &&
    c.programDurationSec >= 0.05
  ) {
    return Math.min(MAX_PROGRAM_CLIP_SEC, Math.max(0.05, c.programDurationSec));
  }
  const trimStart = c.trimStart ?? 0;
  const trimEnd = c.trimEnd ?? 0;
  const raw = Math.max(0, c.end - c.start) - trimStart - trimEnd;
  return Math.max(0.05, raw);
}

/** Build SubRip (.srt) text from timeline clips in program order (skips empty text). */
export function buildSrtFromTimelineClips(clips: StoryTimelineClip[]): string {
  let t = 0;
  const blocks: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dur = clipOutputDurationSec(c);
    const text = (c.text || '').replace(/\r\n/g, '\n').trim();
    if (!text) {
      t += dur;
      continue;
    }
    const start = t;
    const end = t + dur;
    blocks.push(
      `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text.replace(/\n/g, '\n')}\n`
    );
    t += dur;
  }
  return blocks.join('\n');
}
