/**
 * Final export stage: subtitles, BGM mix, and x264 re-encode.
 *
 * Builds SRT from timeline clips, optionally burn-in, mixes background music under voice,
 * then applies the user's export preset. Callers: pipeline/run.ts (initial + re-render).
 */
import fs from 'fs/promises';
import path from 'path';
import { burnInSubtitles, mixBgmWithVoice } from '../../common/utils/ffmpeg.js';
import { getEncodeParams, type StoryJobOptions, type StorySubtitleMode } from '../lib/storyOptions.js';
import { buildSrtFromTimelineClips } from '../lib/subtitles.js';
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Re-encode a video file with libx264 settings from {@link getEncodeParams}. */
export async function reencodeVideoWithPreset(
  inputPath: string,
  outputPath: string,
  preset: StoryJobOptions['exportPreset']
): Promise<void> {
  const { crf, preset: p, audioBitrate } = getEncodeParams(preset);
  const cmd = [
    'ffmpeg',
    '-y',
    `-i "${inputPath}"`,
    '-c:v',
    'libx264',
    '-crf',
    crf,
    '-preset',
    p,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    audioBitrate,
    '-movflags',
    '+faststart',
    `"${outputPath}"`,
  ].join(' ');
  await execAsync(cmd);
}

/**
 * Apply subtitle burn-in and/or sidecar SRT, mix BGM, and produce `final_export.mp4`.
 *
 * @returns `finalPath` — encoded output; `srtPath` — sidecar file when subtitles enabled
 */
export async function applySubtitlesAndBgm(params: {
  videoPath: string;
  workDir: string;
  clips: StoryTimelineClip[];
  subtitleMode: StorySubtitleMode;
  bgmPath?: string;
  bgmVolume: number;
  exportPreset: StoryJobOptions['exportPreset'];
}): Promise<{ finalPath: string; srtPath?: string }> {
  const { videoPath, workDir, clips, subtitleMode, bgmPath, bgmVolume, exportPreset } = params;

  let current = videoPath;
  let srtPath: string | undefined;

  if (subtitleMode !== 'none') {
    const srt = buildSrtFromTimelineClips(clips);
    srtPath = path.join(workDir, 'output.srt');
    await fs.writeFile(srtPath, srt, 'utf8');
  }

  if (subtitleMode === 'burn_in' || subtitleMode === 'both') {
    const srtFile = path.join(workDir, 'output.srt');
    const outBurn = path.join(workDir, '_burn.mp4');
    await fs.copyFile(current, outBurn);
    await burnInSubtitles(outBurn, srtFile);
    current = outBurn;
  }

  if (bgmPath) {
    const voiceOnly = path.join(workDir, 'voice_only.wav');
    await execAsync(
      `ffmpeg -y -i "${current}" -vn -ac 2 -ar 44100 -c:a pcm_s16le "${voiceOnly}"`
    );
    const mixed = path.join(workDir, 'voice_bgm.wav');
    await mixBgmWithVoice(voiceOnly, bgmPath, mixed, bgmVolume);
    const muxOut = path.join(workDir, '_bgm_mux.mp4');
    await execAsync(
      `ffmpeg -y -i "${current}" -i "${mixed}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest -movflags +faststart "${muxOut}"`
    );
    current = muxOut;
    await fs.unlink(voiceOnly).catch(() => {});
    await fs.unlink(mixed).catch(() => {});
  }

  const presetOut = path.join(workDir, 'final_export.mp4');
  await reencodeVideoWithPreset(current, presetOut, exportPreset);

  if (current !== videoPath && current !== presetOut) {
    await fs.unlink(current).catch(() => {});
  }

  /** SRT exists on disk whenever subtitles are enabled (burn-in, sidecar, or both). */
  const returnSrt = subtitleMode !== 'none' ? srtPath : undefined;

  return { finalPath: presetOut, srtPath: returnSrt };
}
