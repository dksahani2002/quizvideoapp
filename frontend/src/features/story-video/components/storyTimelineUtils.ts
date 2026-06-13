import type { StoryClip } from '../api';

const MAX_PROGRAM_CLIP_SEC = 600;

export function clipOutputDurationSec(c: StoryClip): number {
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

export function totalProgramDurationSec(clips: StoryClip[]): number {
  return clips.reduce((s, c) => s + clipOutputDurationSec(c), 0);
}

/** Cumulative start time of clip `index` in the exported program (seconds). */
export function programStartSecForClipIndex(clips: StoryClip[], index: number): number {
  let s = 0;
  for (let i = 0; i < index; i++) s += clipOutputDurationSec(clips[i]!);
  return s;
}

/** Which clip index contains program time `t` (seconds), or `null` if there are no clips. */
export function clipIndexAtProgramTimeSec(clips: StoryClip[], t: number): number | null {
  if (!clips.length) return null;
  if (!Number.isFinite(t) || t < 0) return null;
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clipOutputDurationSec(clips[i]!);
    if (t < acc + d) return i;
    acc += d;
  }
  return clips.length - 1;
}

/** Timecode for timeline display (mm:ss.cc). */
export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
