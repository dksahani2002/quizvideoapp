/**
 * Per-clip render cache for timeline re-exports.
 *
 * Fingerprints visual settings (trim, crop, overlay) so identical clips skip re-encode.
 * Caller: pipeline/rerenderClips.ts
 */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';

/** Stable key when the source file on disk changes (size + mtime). */
export async function getInputVideoCacheKey(inputVideoPath: string): Promise<string> {
  const st = await fs.stat(inputVideoPath);
  return `${st.size}:${Math.floor(st.mtimeMs)}`;
}

/** Strip query strings so presigned URLs don’t bust the cache every hour. */
export function normalizeAssetUrlForFingerprint(url: string): string {
  const t = url.trim();
  if (!t) return '';
  try {
    const u = new URL(t, 'http://localhost');
    return u.pathname;
  } catch {
    return t.split('?')[0];
  }
}

/**
 * Hash of everything that affects the silent clip MP4 (extract + image overlay).
 * Intentionally excludes narration text / clip id so identical visual settings reuse one cached file.
 */
export function clipVisualFingerprint(
  clip: StoryTimelineClip,
  inputCacheKey: string,
  frameW: number,
  frameH: number
): string {
  const o = {
    v: 1,
    in: inputCacheKey,
    fw: frameW,
    fh: frameH,
    start: clip.start,
    end: clip.end,
    ts: clip.trimStart ?? 0,
    te: clip.trimEnd ?? 0,
    si: clip.sourceInSec ?? null,
    st: clip.sourceTakeSec ?? null,
    cn: clip.cropNorm ?? null,
    pd: clip.programDurationSec ?? null,
    oiu: normalizeAssetUrlForFingerprint(clip.overlayImageUrl || ''),
    oov: clip.overlayImageOverridesClip === true,
    oop: clip.overlayOpacity ?? 0.85,
    opos: clip.overlayPosition || 'bottom-right',
  };
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 48);
}

/** On-disk cache path for a clip fingerprint under `workDir/clips_reedit_cache/`. */
export function clipRenderCacheFile(workDir: string, fingerprint: string): string {
  return path.join(workDir, 'clips_reedit_cache', `${fingerprint}.mp4`);
}

/** True if a cached clip MP4 already exists at the given path. */
export async function clipCacheFileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
