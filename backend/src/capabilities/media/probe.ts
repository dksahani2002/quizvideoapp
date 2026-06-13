import { exec } from 'child_process';
import { promisify } from 'util';
import { extractDuration } from '../../common/utils/ffmpeg.js';

const execAsync = promisify(exec);

/** Return media duration in seconds via ffprobe (wrapper around `extractDuration`). */
export async function getMediaDurationSec(filePath: string): Promise<number> {
  return extractDuration(filePath);
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
