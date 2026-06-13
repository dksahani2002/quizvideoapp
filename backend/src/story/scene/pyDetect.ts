/**
 * PySceneDetect CLI integration for story scene cuts.
 *
 * Spawns `scenedetect` (or `python3 -m scenedetect`) and parses `list-scenes` stdout.
 * Caller: scene/detectFacade.ts when `sceneDetectionMode` includes pyscenedetect.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function parseHmsToSeconds(hms: string): number | null {
  const m = hms.trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  return h * 3600 + min * 60 + sec;
}

/** Parse PySceneDetect `list-scenes` table output for scene start times (seconds). */
export function parseListScenesStdout(stdout: string): number[] {
  const times: number[] = [];
  const re = /(\d{2}:\d{2}:\d{2}\.\d{3})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout)) !== null) {
    const t = parseHmsToSeconds(match[1]);
    if (t != null && t > 0) times.push(t);
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

/**
 * Run PySceneDetect CLI if available (`scenedetect` or `python3 -m scenedetect`).
 * Returns cut times in seconds (excluding 0).
 */
export async function detectSceneCutsPySceneDetect(
  videoPath: string,
  _threshold = 27
): Promise<number[]> {
  const args = ['-i', videoPath, 'detect-content', 'list-scenes'];
  try {
    const { stdout } = await execFileAsync('scenedetect', args, {
      timeout: 7200_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return parseListScenesStdout(stdout);
  } catch {
    try {
      const { stdout } = await execFileAsync('python3', ['-m', 'scenedetect', ...args], {
        timeout: 7200_000,
        maxBuffer: 20 * 1024 * 1024,
      });
      return parseListScenesStdout(stdout);
    } catch {
      return [];
    }
  }
}
