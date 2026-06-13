/**
 * Story-video specific FFmpeg helpers (cut, concat without audio, scene detection).
 *
 * Higher-level story operations (burn-in, BGM) live in `common/utils/ffmpeg.ts`.
 * Callers: pipeline/run.ts, pipeline/rerenderClips.ts, scene/detectFacade.ts, narration paths.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { extractDuration } from '../../common/utils/ffmpeg.js';
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { clipOutputDurationSec } from '../lib/subtitles.js';

const execAsync = promisify(exec);

/** Extract mono 16 kHz PCM WAV from video or audio (Whisper / scene-detect input). */
export async function extractAudioWav16kMono(inputVideoOrAudio: string, outWav: string): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    `-i "${inputVideoOrAudio}"`,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    `"${outWav}"`,
  ].join(' ');
  await execAsync(cmd);
}

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

/** Return native video stream width/height (defaults to 1920×1080 if probe fails). */
export async function getVideoStreamDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  const escaped = inputPath.replace(/"/g, '\\"');
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${escaped}"`;
  const { stdout } = await execAsync(cmd);
  const j = JSON.parse(stdout || '{}') as { streams?: Array<{ width?: number; height?: number }> };
  const s = j.streams?.[0];
  const width = typeof s?.width === 'number' && s.width > 0 ? s.width : 1920;
  const height = typeof s?.height === 'number' && s.height > 0 ? s.height : 1080;
  return { width, height };
}

/**
 * Cut one timeline clip from the original upload: optional source in-point / longer take (trim to slot),
 * optional normalized crop, scale/pad to project frame size.
 */
export async function extractStoryRerenderClip(
  inputPath: string,
  outputPath: string,
  clip: StoryTimelineClip,
  frameWidth: number,
  frameHeight: number
): Promise<void> {
  const trimStart = clip.trimStart ?? 0;
  const trimEnd = clip.trimEnd ?? 0;
  const defaultIn = clip.start + trimStart;
  const defaultSpan = Math.max(0.2, clip.end - trimEnd - defaultIn);
  const sourceInSec =
    clip.sourceInSec != null && Number.isFinite(clip.sourceInSec) ? Math.max(0, clip.sourceInSec) : defaultIn;
  const sourceTakeSec =
    clip.sourceTakeSec != null && Number.isFinite(clip.sourceTakeSec) && clip.sourceTakeSec > 0.05
      ? clip.sourceTakeSec
      : defaultSpan;
  const outputDurationSec = clipOutputDurationSec(clip);

  const crop = clip.cropNorm;
  const hasCrop =
    crop &&
    crop.w > 0.01 &&
    crop.h > 0.01 &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.w <= 1.001 &&
    crop.y + crop.h <= 1.001;

  const vfParts: string[] = [];
  if (hasCrop && crop) {
    const iw = frameWidth;
    const ih = frameHeight;
    const cw = Math.max(2, Math.floor(iw * Math.min(1, crop.w) / 2) * 2);
    const ch = Math.max(2, Math.floor(ih * Math.min(1, crop.h) / 2) * 2);
    let cx = Math.floor(iw * Math.max(0, crop.x) / 2) * 2;
    let cy = Math.floor(ih * Math.max(0, crop.y) / 2) * 2;
    cx = Math.min(cx, Math.max(0, iw - cw));
    cy = Math.min(cy, Math.max(0, ih - ch));
    vfParts.push(
      `crop=${cw}:${ch}:${cx}:${cy},scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
    );
  }

  const padSec = Math.max(0, outputDurationSec - sourceTakeSec);
  if (padSec > 0.05) {
    vfParts.push(`tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}`);
  }

  const vf = vfParts.length > 0 ? vfParts.join(',') : '';

  const inEsc = inputPath.replace(/"/g, '\\"');
  const outEsc = outputPath.replace(/"/g, '\\"');
  const args = [
    'ffmpeg',
    '-y',
    '-ss',
    String(sourceInSec),
    '-i',
    `"${inEsc}"`,
    '-t',
    String(Math.max(0.1, sourceTakeSec)),
    '-an',
  ];
  if (vf) {
    args.push('-vf', `"${vf}"`);
  }
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
    String(Math.max(0.05, outputDurationSec)),
    '-movflags',
    '+faststart',
    `"${outEsc}"`
  );
  await execAsync(args.join(' '));
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

/** Concatenate MP3 files into one output (delegates to common `concatAudio`). */
export async function concatAudioFilesMp3(inputFiles: string[], outputMp3: string): Promise<void> {
  const { concatAudio } = await import('../../common/utils/ffmpeg.js');
  await concatAudio(inputFiles, outputMp3);
}

/** Build non-overlapping scene windows from cut times + duration. Caps segment count for very long files. */
export function buildSceneWindows(
  durationSec: number,
  cutTimes: number[],
  opts?: { maxScenes?: number; minSceneSec?: number }
): Array<{ start: number; end: number }> {
  const maxScenes = opts?.maxScenes ?? 400;
  const minScene = opts?.minSceneSec ?? 0.5;
  let cuts = [...new Set(cutTimes.filter((t) => t > 0 && t < durationSec))].sort((a, b) => a - b);
  if (cuts.length > maxScenes - 1) {
    const step = Math.ceil(cuts.length / (maxScenes - 1));
    cuts = cuts.filter((_, i) => i % step === 0);
  }
  const points = [0, ...cuts, durationSec];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end - start >= minScene) out.push({ start, end });
  }
  if (out.length === 0) {
    const step = Math.min(30, Math.max(5, durationSec / 20));
    for (let t = 0; t < durationSec; t += step) {
      out.push({ start: t, end: Math.min(durationSec, t + step) });
    }
  }
  return out;
}

/** Return media duration in seconds via ffprobe (wrapper around `extractDuration`). */
export async function getMediaDurationSec(filePath: string): Promise<number> {
  return extractDuration(filePath);
}

/**
 * Encode a still image as an MP4 segment at project resolution (cover crop), for full-frame clip override.
 */
export async function stillImageToProgramClipMp4(
  imagePath: string,
  outputPath: string,
  durationSec: number,
  frameWidth: number,
  frameHeight: number
): Promise<void> {
  const d = Math.max(0.05, durationSec);
  const w = Math.max(2, Math.floor(frameWidth / 2) * 2);
  const h = Math.max(2, Math.floor(frameHeight / 2) * 2);
  const imgEsc = imagePath.replace(/"/g, '\\"');
  const outEsc = outputPath.replace(/"/g, '\\"');
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuv420p`;
  const cmd = [
    'ffmpeg',
    '-y',
    '-loop',
    '1',
    '-i',
    `"${imgEsc}"`,
    '-t',
    String(d),
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-r',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    `"${outEsc}"`,
  ].join(' ');
  await execAsync(cmd);
}

/** Composite a watermark/overlay image onto a video copy (position + opacity). */
export async function overlayImageOnVideo(
  videoPath: string,
  imagePath: string,
  outputPath: string,
  opts?: { opacity?: number; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
): Promise<void> {
  const { overlayWatermark } = await import('../../common/utils/ffmpeg.js');
  const fs = await import('fs/promises');
  await fs.copyFile(videoPath, outputPath);
  await overlayWatermark(outputPath, imagePath, opts);
}
