/**
 * Render trailer breakdown segments: cut clips, lower-third overlay, TTS mux.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import type { BreakdownSegment } from '../../common/db/models/TrailerBreakdownJob.js';
import type { TrailerJobOptionsDoc } from '../../common/db/models/TrailerBreakdownJob.js';
import { resolvePathUnderAssetsDir } from '../../common/config/paths.js';
import type { AppSettings } from '../../common/services/settingsService.js';
import { createTtsFromSettings } from '../../capabilities/voice/index.js';
import {
  cutAndPadSilentSegment,
  concatVideoFilesConcatDemuxer,
  concatAudioFilesMp3,
  muxVideoWithAudio,
  getMediaDurationSec,
} from '../../story/render/ffmpeg.js';

const execFileAsync = promisify(execFile);

function escapeFilterPath(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/** Clamp GPT segment times to the source trailer and fix invalid/out-of-range windows. */
function resolveSegmentWindow(
  seg: BreakdownSegment,
  index: number,
  total: number,
  sourceDurationSec: number
): { startSec: number; endSec: number } {
  const dur = Math.max(1, sourceDurationSec);
  let startSec = Math.max(0, Math.min(seg.startSec, dur - 0.5));
  let endSec = Math.max(startSec + 0.5, Math.min(seg.endSec, dur));

  if (endSec <= startSec || endSec - startSec < 0.25) {
    if (index === total - 1) {
      startSec = Math.max(0, dur - Math.min(4, dur));
      endSec = dur;
    } else {
      endSec = Math.min(dur, startSec + Math.max(1, Math.min(4, dur - startSec)));
    }
  }

  return { startSec, endSec };
}

async function assertVideoDuration(filePath: string, minSec = 0.1): Promise<number> {
  const d = await getMediaDurationSec(filePath);
  if (!Number.isFinite(d) || d < minSec) {
    throw new Error(`Invalid video clip (duration ${d}s): ${filePath}`);
  }
  return d;
}

async function burnLowerThird(inputPath: string, label: string, outputPath: string): Promise<void> {
  const fontRel = resolvePathUnderAssetsDir('fonts/Montserrat-Bold.ttf');
  const fontFile = fontRel || path.resolve('assets/fonts/Montserrat-Bold.ttf');
  const textFile = outputPath.replace(/\.mp4$/i, '_label.txt');
  await fs.writeFile(textFile, label.slice(0, 120).trim(), 'utf8');

  const vf =
    `drawtext=fontfile=${escapeFilterPath(fontFile)}` +
    `:textfile=${escapeFilterPath(textFile)}` +
    `:fontsize=28:fontcolor=white` +
    `:box=1:boxcolor=black@0.55:boxborderw=14` +
    `:x=40:y=h-th-40`;

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      vf,
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
      outputPath,
    ],
    { maxBuffer: 50 * 1024 * 1024 }
  );
}

async function cutSegmentVideo(params: {
  sourceVideoPath: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  outputPath: string;
  sourceDurationSec: number;
}): Promise<void> {
  const { sourceVideoPath, startSec, endSec, durationSec, outputPath, sourceDurationSec } = params;
  const clipLen = Math.max(0.5, endSec - startSec);
  const videoTake = Math.min(clipLen, durationSec);

  await cutAndPadSilentSegment(sourceVideoPath, startSec, videoTake, durationSec, outputPath);

  try {
    await assertVideoDuration(outputPath);
    return;
  } catch {
    const fallbackStart = Math.max(0, sourceDurationSec - Math.min(3, sourceDurationSec));
    const fallbackTake = Math.min(3, sourceDurationSec - fallbackStart);
    await cutAndPadSilentSegment(
      sourceVideoPath,
      fallbackStart,
      Math.max(0.5, fallbackTake),
      durationSec,
      outputPath
    );
    await assertVideoDuration(outputPath);
  }
}

/** Synthesize TTS MP3 for one narration line; returns path + duration. */
async function synthesizeSegmentAudio(params: {
  text: string;
  index: number;
  workDir: string;
  settings: AppSettings;
  language: string;
  options: TrailerJobOptionsDoc;
}): Promise<{ audioPath: string; durationSec: number }> {
  const { text, index, workDir, settings, language, options } = params;
  const cacheDir = path.join(workDir, 'tts-cache');
  const { tts, resolved } = createTtsFromSettings(settings, cacheDir, {
    ttsProvider: options.ttsProvider,
    ttsVoice: options.ttsVoice,
    ttsModel: options.ttsModel,
    systemVoice: options.systemVoice,
    elevenlabsModelId: options.elevenlabsModelId,
  });

  const out = path.join(workDir, `seg_tts_${String(index).padStart(3, '0')}.mp3`);
  const generated = await tts.generate(text, language, resolved.voice);
  await fs.copyFile(generated, out);
  const durationSec = await getMediaDurationSec(out);
  return { audioPath: out, durationSec: Math.max(0.5, durationSec) };
}

export type AssembleProgress = (pct: number, message: string) => Promise<void>;

async function segmentFinalExists(clipsDir: string, index: number): Promise<boolean> {
  try {
    await fs.access(path.join(clipsDir, `seg_${index}_final.mp4`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Render all breakdown segments and concat into a final MP4 with narration.
 */
export async function assembleBreakdownVideo(params: {
  sourceVideoPath: string;
  segments: BreakdownSegment[];
  workDir: string;
  settings: AppSettings;
  options: TrailerJobOptionsDoc;
  onProgress?: AssembleProgress;
  forceRerender?: boolean;
}): Promise<{ finalPath: string; narrationPath: string }> {
  const {
    sourceVideoPath,
    segments,
    workDir,
    settings,
    options,
    onProgress,
    forceRerender = false,
  } = params;
  const language = options.narrationLanguage || 'en';
  const clipsDir = path.join(workDir, 'breakdown-clips');
  await fs.mkdir(clipsDir, { recursive: true });
  const sourceDurationSec = await getMediaDurationSec(sourceVideoPath);

  const segmentVideos: string[] = [];
  const segmentAudios: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const muxedClip = path.join(clipsDir, `seg_${i}_final.mp4`);
    const cachedAudio = path.join(workDir, `seg_tts_${String(i).padStart(3, '0')}.mp3`);

    if (!forceRerender && (await segmentFinalExists(clipsDir, i))) {
      await onProgress?.(
        55 + Math.floor((i / segments.length) * 30),
        `Using cached segment ${i + 1}/${segments.length}`
      );
      segmentVideos.push(muxedClip);
      try {
        await fs.access(cachedAudio);
        segmentAudios.push(cachedAudio);
      } catch {
        const { audioPath } = await synthesizeSegmentAudio({
          text: seg.narration,
          index: i,
          workDir,
          settings,
          language,
          options,
        });
        segmentAudios.push(audioPath);
      }
      continue;
    }

    await onProgress?.(
      55 + Math.floor((i / segments.length) * 30),
      `Rendering segment ${i + 1}/${segments.length}: ${seg.label}`
    );

    const { audioPath, durationSec } = await synthesizeSegmentAudio({
      text: seg.narration,
      index: i,
      workDir,
      settings,
      language,
      options,
    });
    segmentAudios.push(audioPath);

    const { startSec, endSec } = resolveSegmentWindow(seg, i, segments.length, sourceDurationSec);
    const silentClip = path.join(clipsDir, `seg_${i}_silent.mp4`);
    await cutSegmentVideo({
      sourceVideoPath,
      startSec,
      endSec,
      durationSec,
      outputPath: silentClip,
      sourceDurationSec,
    });

    const label = seg.onScreenText || seg.label || '';
    const labeledClip = path.join(clipsDir, `seg_${i}_labeled.mp4`);
    if (label.trim()) {
      await burnLowerThird(silentClip, label, labeledClip);
    } else {
      await fs.copyFile(silentClip, labeledClip);
    }

    const muxedClipOut = path.join(clipsDir, `seg_${i}_final.mp4`);
    await muxVideoWithAudio(labeledClip, audioPath, muxedClipOut);
    segmentVideos.push(muxedClipOut);
  }

  await onProgress?.(88, 'Concatenating breakdown segments…');

  const mergedVideoPath = path.join(workDir, 'breakdown_merged_video.mp4');
  await concatVideoFilesConcatDemuxer(segmentVideos, mergedVideoPath);

  const narrationPath = path.join(workDir, 'breakdown_narration_full.mp3');
  await concatAudioFilesMp3(segmentAudios, narrationPath);

  // concat demuxer strips audio (-an); mux full narration track onto the merged video
  const finalPath = path.join(workDir, 'breakdown_output.mp4');
  await muxVideoWithAudio(mergedVideoPath, narrationPath, finalPath);

  return { finalPath, narrationPath };
}
