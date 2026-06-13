/**
 * Scene detection facade: ffmpeg filter, PySceneDetect, or hybrid merge.
 *
 * Picks cut times based on scene detection mode. Results feed
 * {@link buildSceneWindows} in pipeline/run.ts.
 */
import { detectSceneCutTimes } from '../video.js';
import { detectSceneCutsPySceneDetect } from './pyDetect.js';
import type { SceneDetectionMode } from './types.js';

function mergeCutTimes(a: number[], b: number[], durationSec: number): number[] {
  const set = new Set<number>([...a, ...b].filter((t) => t > 0 && t < durationSec));
  return [...set].sort((x, y) => x - y);
}

/**
 * Resolve scene cut timestamps for a source video.
 *
 * @param mode — `ffmpeg`, `pyscenedetect`, or `hybrid` (union of both detectors)
 * @param ffmpegThreshold — passed to ffmpeg `select=gt(scene,…)` (0–1)
 * @returns Sorted cut times in seconds (excluding 0 and duration)
 */
export async function resolveSceneCuts(
  videoPath: string,
  durationSec: number,
  mode: SceneDetectionMode,
  ffmpegThreshold: number
): Promise<number[]> {
  let ff: number[] = [];
  let py: number[] = [];

  if (mode === 'ffmpeg' || mode === 'hybrid') {
    try {
      ff = await detectSceneCutTimes(videoPath, ffmpegThreshold);
    } catch {
      ff = [];
    }
  }

  if (mode === 'pyscenedetect' || mode === 'hybrid') {
    py = await detectSceneCutsPySceneDetect(videoPath);
  }

  if (mode === 'hybrid') {
    return mergeCutTimes(ff, py, durationSec);
  }
  if (mode === 'pyscenedetect') {
    return py.length ? py : ff;
  }
  return ff;
}
