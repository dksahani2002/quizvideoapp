/**
 * Narration audio rebuild for timeline re-renders.
 *
 * Reorders/trims narration MP3 segments to match edited clips. Skips FFmpeg when
 * narration inputs are unchanged (fingerprint cache). Caller: pipeline/run.ts re-render path.
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import type { IStoryVideoJob, StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { extractAudioSegment, concatAudioFilesMp3 } from '../render/ffmpeg.js';
import { estimatedDurationSec } from '../narration/narration.js';
import { clipOutputDurationSec } from '../lib/subtitles.js';
import type { NarrationSegment } from '../lib/types.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveNarrationMuxPath(job: IStoryVideoJob, workDir: string): Promise<string | undefined> {
  const muxMetaPath = path.join(workDir, 'narration_mux.json');
  if (await pathExists(muxMetaPath)) {
    const meta = JSON.parse(await fs.readFile(muxMetaPath, 'utf8')) as { muxPath?: string };
    const p = (meta.muxPath || '').trim();
    return p || job.inputAudioLocalPath;
  }
  return job.inputAudioLocalPath;
}

function narrationSegmentsPath(job: IStoryVideoJob, workDir: string): string {
  return job.intermediate?.narrationSegmentsJson || path.join(workDir, 'narration.json');
}

async function loadNarrationSegments(job: IStoryVideoJob, workDir: string): Promise<NarrationSegment[]> {
  const narrPath = narrationSegmentsPath(job, workDir);
  if (!(await pathExists(narrPath))) {
    throw new Error('Missing narration.json for re-render');
  }
  return JSON.parse(await fs.readFile(narrPath, 'utf8')) as NarrationSegment[];
}

/** Generate a silent MP3 of the given duration (padding when narration is shorter than clip). */
export async function writeSilenceMp3(durationSec: number, outPath: string): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const t = Math.max(0.1, durationSec);
  await execAsync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${t} -c:a libmp3lame -q:a 3 "${outPath}"`
  );
}

/**
 * Fingerprint everything that affects re-render narration output.
 *
 * Hash covers narration.json, mux source file, and per-clip layout/duration so visual-only
 * timeline edits can reuse `final_narration.mp3`.
 */
export async function computeNarrationRerenderInputsFingerprint(
  job: IStoryVideoJob,
  workDir: string,
  clips: StoryTimelineClip[],
  narrPathExplicit?: string
): Promise<string> {
  const narrPath = narrPathExplicit || narrationSegmentsPath(job, workDir);
  if (!(await pathExists(narrPath))) {
    return '';
  }
  const narrHash = createHash('sha256').update(await fs.readFile(narrPath)).digest('hex');
  const narrationMuxPath = await resolveNarrationMuxPath(job, workDir);

  let muxSig: string;
  const mux = (narrationMuxPath || '').trim();
  if (mux && (await pathExists(mux))) {
    const resolved = path.resolve(mux);
    const st = await fs.stat(resolved);
    muxSig = `${resolved}:${st.size}:${st.mtimeMs}`;
  } else {
    muxSig = mux ? `missing:${path.resolve(mux)}` : 'no_mux';
  }

  const layout = clips.map((c, i) => ({
    n: c.narrationIndex ?? i,
    d: clipOutputDurationSec(c),
  }));

  return createHash('sha256').update(JSON.stringify({ narrHash, muxSig, layout })).digest('hex');
}

/**
 * Rebuild `final_narration.mp3` in timeline clip order.
 *
 * Extracts timed segments from the narration mux or inserts silence; pads to each clip's
 * program duration. Always runs FFmpeg (no cache check).
 */
export async function rebuildFinalNarrationMp3ForRerender(
  job: IStoryVideoJob,
  workDir: string,
  clips: StoryTimelineClip[]
): Promise<string> {
  const narration = await loadNarrationSegments(job, workDir);
  const narrationMuxPath = await resolveNarrationMuxPath(job, workDir);
  const hasTimedNarration =
    !!narrationMuxPath && narration.every((n) => n.startSec != null && n.endSec != null);

  const parts: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const vidDur = clipOutputDurationSec(c);
    const nIdx = c.narrationIndex ?? i;
    const n = narration[nIdx];
    if (!n) throw new Error(`Missing narration segment ${nIdx} for re-render`);

    let narrDur: number;
    if (n.startSec != null && n.endSec != null) {
      narrDur = Math.max(0.2, n.endSec - n.startSec);
    } else {
      narrDur = estimatedDurationSec(n.text);
    }
    const targetDur = Math.min(narrDur, vidDur);
    const partPath = path.join(workDir, `reedit_narr_${i}.mp3`);

    if (hasTimedNarration && narrationMuxPath && n.startSec != null) {
      await extractAudioSegment(narrationMuxPath, n.startSec, targetDur, partPath);
    } else {
      await writeSilenceMp3(targetDur, partPath);
    }

    if (vidDur > targetDur + 0.05) {
      const padPath = path.join(workDir, `reedit_narr_pad_${i}.mp3`);
      await writeSilenceMp3(vidDur - targetDur, padPath);
      const mergedPath = path.join(workDir, `reedit_narr_seg_${i}.mp3`);
      await concatAudioFilesMp3([partPath, padPath], mergedPath);
      parts.push(mergedPath);
    } else {
      parts.push(partPath);
    }
  }

  const finalAudio = path.join(workDir, 'final_narration.mp3');
  await concatAudioFilesMp3(parts, finalAudio);
  return finalAudio;
}

/**
 * Return cached `final_narration.mp3` or rebuild when narration inputs changed.
 *
 * Compares fingerprint to `job.intermediate.narrationRerenderFingerprint` from the last export.
 */
export async function resolveFinalNarrationForRerender(
  job: IStoryVideoJob,
  workDir: string,
  clips: StoryTimelineClip[],
  onProgress: (pct: number, message: string) => Promise<void>
): Promise<{ path: string; fingerprint: string }> {
  const finalAudioPath = path.join(workDir, 'final_narration.mp3');
  const narrFp = await computeNarrationRerenderInputsFingerprint(job, workDir, clips);
  const prevNarrFp = job.intermediate?.narrationRerenderFingerprint;

  if (narrFp && prevNarrFp === narrFp && (await pathExists(finalAudioPath))) {
    await onProgress(85, 'Narration audio unchanged — reusing existing mix');
    return { path: finalAudioPath, fingerprint: narrFp };
  }

  await onProgress(85, 'Rebuilding narration audio for current timeline…');
  const pathBuilt = await rebuildFinalNarrationMp3ForRerender(job, workDir, clips);
  return { path: pathBuilt, fingerprint: narrFp };
}
