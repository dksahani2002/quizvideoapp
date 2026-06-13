import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/** Scene change timestamps (seconds), excluding 0 and duration. Uses `select` scene filter. */
export async function detectSceneCutTimes(inputPath: string, sceneThreshold = 0.32): Promise<number[]> {
  const escaped = inputPath.replace(/"/g, '\\"');
  const cmd = `ffmpeg -hide_banner -i "${escaped}" -filter:v "select='gt(scene\\,${sceneThreshold})',showinfo" -f null - 2>&1`;
  const { stdout, stderr } = await execAsync(cmd);
  const text = `${stdout}\n${stderr}`;
  const times: number[] = [];
  const re = /pts_time:([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = parseFloat(m[1]);
    if (!Number.isNaN(t)) times.push(t);
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

/** Cut a silent H.264 segment from `startSec` for `durationSec` (no pad). */
export async function cutVideoSilentSegment(
  inputPath: string,
  startSec: number,
  durationSec: number,
  outputPath: string
): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    '-ss',
    String(startSec),
    '-i',
    `"${inputPath}"`,
    '-t',
    String(Math.max(0.1, durationSec)),
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    `"${outputPath}"`,
  ].join(' ');
  await execAsync(cmd);
}

/**
 * Decode `decodeSec` seconds from `startSec`, then pad with cloned last frame so the file lasts `outputDurationSec`.
 * Used so each program clip matches narration length while only taking up to `decodeSec` from the source scene.
 */
export async function cutAndPadSilentSegment(
  inputPath: string,
  startSec: number,
  decodeSec: number,
  outputDurationSec: number,
  outputPath: string
): Promise<void> {
  const dec = Math.max(0.1, decodeSec);
  const out = Math.max(0.05, outputDurationSec);
  const readSec = Math.min(dec, out);
  const padSec = Math.max(0, out - readSec);
  const vf =
    padSec > 0.05 ? `tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}` : '';
  const inEsc = inputPath.replace(/"/g, '\\"');
  const outEsc = outputPath.replace(/"/g, '\\"');
  const args = [
    'ffmpeg',
    '-y',
    '-ss',
    String(startSec),
    '-i',
    `"${inEsc}"`,
    '-t',
    String(readSec),
    '-an',
  ];
  if (vf) args.push('-vf', `"${vf}"`);
  args.push(
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(out),
    '-movflags',
    '+faststart',
    `"${outEsc}"`
  );
  await execAsync(args.join(' '));
}

/**
 * Concatenate silent MP4 clips via ffmpeg concat demuxer (copy first, re-encode fallback).
 */
export async function concatVideoFilesConcatDemuxer(videoFiles: string[], outputPath: string): Promise<void> {
  const listPath = outputPath.replace(/\.mp4$/i, '_concat_list.txt');
  const lines = videoFiles.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, lines, 'utf8');

  const base = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', `-i "${listPath}"`];

  const tryCopy = [...base, '-c:v', 'copy', '-an', '-movflags', '+faststart', `"${outputPath}"`].join(' ');
  const reencode = [
    ...base,
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    `"${outputPath}"`,
  ].join(' ');

  try {
    try {
      await execAsync(tryCopy);
    } catch {
      await execAsync(reencode);
    }
  } finally {
    await fs.unlink(listPath).catch(() => {});
  }
}

/** Mux an AAC audio track onto a video (video stream copied; `-shortest`). */
export async function muxVideoWithAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    `-i "${videoPath}"`,
    `-i "${audioPath}"`,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    `"${outputPath}"`,
  ].join(' ');
  await execAsync(cmd);
}

/** Extract a slice of narration/audio as MP3 from `startSec` for `durationSec`. */
export async function extractAudioSegment(
  inputAudio: string,
  startSec: number,
  durationSec: number,
  outputPath: string
): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    '-ss',
    String(startSec),
    '-i',
    `"${inputAudio}"`,
    '-t',
    String(Math.max(0.05, durationSec)),
    '-c:a',
    'libmp3lame',
    '-q:a',
    '3',
    `"${outputPath}"`,
  ].join(' ');
  await execAsync(cmd);
}
