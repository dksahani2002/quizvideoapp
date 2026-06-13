/**
 * Per-clip video extraction for timeline re-renders.
 *
 * Downloads overlay images, cuts source video (crop/trim/pad), applies image overlays,
 * and caches silent MP4s by visual fingerprint. Caller: pipeline/run.ts `renderStoryJobFromCurrentTimeline`.
 */
import fs from 'fs/promises';
import path from 'path';
import type { StoryTimelineClip } from '../../common/db/models/StoryVideoJob.js';
import { downloadHttpToFileOrLocalUserMedia } from '../io/downloadAsset.js';
import {
  clipCacheFileExists,
  clipRenderCacheFile,
  clipVisualFingerprint,
  getInputVideoCacheKey,
} from '../render/clipCache.js';
import {
  extractStoryRerenderClip,
  getVideoStreamDimensions,
  overlayImageOnVideo,
  stillImageToProgramClipMp4,
} from '../render/ffmpeg.js';
import { clipOutputDurationSec } from '../lib/subtitles.js';

function overlayImageExt(url: string): string {
  return url.split('.').pop()?.slice(0, 8) || 'png';
}

async function downloadClipOverlayImage(
  workDir: string,
  clipIndex: number,
  url: string,
  filePrefix: string
): Promise<string> {
  const imgPath = path.join(workDir, `${filePrefix}_${clipIndex}.${overlayImageExt(url)}`);
  await downloadHttpToFileOrLocalUserMedia(url, imgPath);
  return imgPath;
}

/**
 * Render each timeline clip and return absolute paths for the concat demuxer.
 *
 * Reuses `clips_reedit_cache/` when {@link clipVisualFingerprint} matches a prior render.
 */
export async function buildRerenderClipPaths(params: {
  workDir: string;
  inputVideo: string;
  clips: StoryTimelineClip[];
  onProgress: (pct: number, message: string) => Promise<void>;
}): Promise<string[]> {
  const { workDir, inputVideo, clips, onProgress } = params;
  const n = clips.length;
  const clipsDir = path.join(workDir, 'clips_reedit');
  await fs.mkdir(clipsDir, { recursive: true });
  await fs.mkdir(path.join(workDir, 'clips_reedit_cache'), { recursive: true });

  const { width: srcW, height: srcH } = await getVideoStreamDimensions(inputVideo);
  const inputCacheKey = await getInputVideoCacheKey(inputVideo);
  const clipPaths: string[] = [];

  for (let i = 0; i < n; i++) {
    const pct = Math.min(78, 5 + Math.floor((75 * (i + 1)) / Math.max(1, n)));
    const c = clips[i]!;
    const fp = clipVisualFingerprint(c, inputCacheKey, srcW, srcH);
    const cacheFile = clipRenderCacheFile(workDir, fp);
    const outFinal = path.join(clipsDir, `clip_${String(i).padStart(4, '0')}.mp4`);

    if (await clipCacheFileExists(cacheFile)) {
      await onProgress(pct, `Clip ${i + 1}/${n} — reused cache (no video re-encode for this block)`);
      clipPaths.push(path.resolve(cacheFile));
      continue;
    }

    const overlayUrl = c.overlayImageUrl?.trim();
    if (overlayUrl && c.overlayImageOverridesClip) {
      await onProgress(pct, `Clip ${i + 1}/${n} — full-frame image (replaces video)…`);
      const imgPath = await downloadClipOverlayImage(workDir, i, overlayUrl, 'overlay_full');
      await stillImageToProgramClipMp4(imgPath, outFinal, clipOutputDurationSec(c), srcW, srcH);
      await fs.copyFile(outFinal, cacheFile);
      clipPaths.push(outFinal);
      continue;
    }

    await onProgress(pct, `Cutting clip ${i + 1}/${n}…`);
    const preOv = path.join(clipsDir, `_extract_${String(i).padStart(4, '0')}.mp4`);
    await extractStoryRerenderClip(inputVideo, preOv, c, srcW, srcH);

    try {
      if (overlayUrl) {
        const imgPath = await downloadClipOverlayImage(workDir, i, overlayUrl, 'overlay');
        await overlayImageOnVideo(preOv, imgPath, outFinal, {
          opacity: c.overlayOpacity ?? 0.85,
          position: c.overlayPosition || 'bottom-right',
        });
        await fs.unlink(preOv).catch(() => {});
      } else {
        await fs.rename(preOv, outFinal);
      }
    } catch (e) {
      await fs.unlink(preOv).catch(() => {});
      throw e;
    }

    await fs.copyFile(outFinal, cacheFile);
    clipPaths.push(outFinal);
  }

  return clipPaths;
}
