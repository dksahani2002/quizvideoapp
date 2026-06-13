/**
 * Story-video specific FFmpeg helpers (rerender clips, still images, overlays).
 *
 * Generic media ops live in `capabilities/media`. Higher-level story operations
 * (burn-in, BGM) live in `common/utils/ffmpeg.ts`.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { clipOutputDurationSec } from '../lib/subtitles.js';

const execAsync = promisify(exec);

export {
  extractAudioWav16kMono,
  concatAudioFilesMp3,
  detectSceneCutTimes,
  cutVideoSilentSegment,
  cutAndPadSilentSegment,
  concatVideoFilesConcatDemuxer,
  muxVideoWithAudio,
  extractAudioSegment,
  getMediaDurationSec,
  getVideoStreamDimensions,
  buildSceneWindows,
} from '../../capabilities/media/index.js';

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
