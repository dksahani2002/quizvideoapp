/**
 * Story input asset downloader.
 *
 * Pulls user-provided video/audio/bgm/overlay URLs onto disk before ffmpeg runs.
 * Supports:
 *   - s3://bucket/key (AWS SDK via s3Storage)
 *   - https presigned or public URLs (fetch + streaming size limit)
 *   - https S3 URLs that 403 over HTTP (SDK fallback when server has GetObject IAM)
 *   - Local dev uploads at /api/story-video/user-media/… (copy from TEMP_DIR, no HTTP)
 *
 * Callers:
 *   - storyVideoRoutes.ts — job creation (videoUrl, audioUrl, bgmSourceUrl)
 *   - rerenderClips.ts — timeline overlay images
 *
 * Prefer {@link downloadHttpToFileOrLocalUserMedia} in app code; use {@link downloadHttpToFile}
 * only when you know the URL is never a local user-media path.
 */
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { downloadObjectToFileLimited } from '../../common/services/s3Storage.js';
import { parseS3Uri, tryParseS3HttpUrl } from './s3InputUri.js';

/** Default cap: 4 GiB. Override with STORY_ASSET_MAX_DOWNLOAD_BYTES. */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
/** Abort fetch if the remote server stalls (large video uploads). */
const FETCH_TIMEOUT_MS = 45 * 60 * 1000;

/** Max bytes allowed for a single story input download (env or default). */
function maxDownloadBytes(): number {
  const n = parseInt(process.env.STORY_ASSET_MAX_DOWNLOAD_BYTES || String(DEFAULT_MAX_BYTES), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

/**
 * When true (default), an HTTP 403 AccessDenied on an S3 HTTPS URL triggers
 * downloadObjectToFileLimited instead of failing immediately.
 * Set STORY_S3_SDK_FALLBACK=0 to disable.
 */
function sdkFallbackOn403Enabled(): boolean {
  const v = process.env.STORY_S3_SDK_FALLBACK?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

/** Actionable hint appended to S3 permission errors. */
function accessDeniedHelp(): string {
  return (
    'S3 AccessDenied on HTTP. Fix: use a presigned GET URL (not PUT). ' +
    'Or paste s3://bucket/key if this server has AWS credentials with s3:GetObject. ' +
    'Or enable automatic SDK fallback (default on): server IAM must allow GetObject on that object.'
  );
}

/** Matches GET /api/story-video/user-media/:userId/:filename (local dev when S3 is unset). */
const USER_MEDIA_PATH_RE = /\/api\/story-video\/user-media\/([^/]+)\/([^/]+)$/;

/**
 * Resolve a story user-media URL to its on-disk path in local dev.
 *
 * Used when the frontend uploads via POST /upload-user-media (no S3 bucket configured).
 * Returns null if the URL is not that route or fails path-traversal checks.
 *
 * @returns Absolute path under TEMP_DIR/story-user-media/{userId}/, or null.
 */
export function tryResolveLocalStoryUserMediaPath(url: string): string | null {
  const noQuery = url.trim().split('?')[0];
  let pathname = '';
  try {
    pathname = new URL(noQuery).pathname;
  } catch {
    // Allow relative paths like /api/story-video/user-media/… without a host.
    if (noQuery.startsWith('/api/story-video/user-media/')) pathname = noQuery;
    else return null;
  }
  const m = pathname.match(USER_MEDIA_PATH_RE);
  if (!m) return null;
  const uid = m[1];
  const file = path.basename(m[2]);
  // userId must be a Mongo ObjectId; filename is uuid + extension from multer.
  if (!/^[a-f0-9]{24}$/i.test(uid)) return null;
  if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(file)) return null;
  const base = path.resolve(path.join(process.env.TEMP_DIR || './temp', 'story-user-media', uid));
  const full = path.resolve(path.join(base, file));
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * Main entry point for story asset downloads.
 *
 * 1. If url is a local user-media path → copyFile (fast, works without HTTP server loopback).
 * 2. Otherwise → {@link downloadHttpToFile}.
 *
 * @param url — http(s), s3://, or /api/story-video/user-media/…
 * @param destPath — absolute path where the file should land (parent dir must exist)
 */
export async function downloadHttpToFileOrLocalUserMedia(url: string, destPath: string): Promise<void> {
  const local = tryResolveLocalStoryUserMediaPath(url);
  if (local) {
    try {
      const st = await fs.stat(local);
      if (st.isFile()) {
        await fs.copyFile(local, destPath);
        return;
      }
    } catch {
      /* local cache miss — fall through to HTTP/S3 download */
    }
  }
  await downloadHttpToFile(url, destPath);
}

/**
 * Download a remote story asset to destPath.
 *
 * Resolution order:
 *   1. s3://bucket/key → AWS SDK (downloadObjectToFileLimited)
 *   2. http(s) → fetch with redirect follow, stream to disk, enforce max bytes
 *   3. http(s) 403 on S3 URL → parse bucket/key, retry via SDK if fallback enabled
 *
 * Validates final file size (min 32 bytes, max STORY_ASSET_MAX_DOWNLOAD_BYTES).
 * Deletes destPath on failure so callers do not leave partial files.
 *
 * @throws if url is neither http(s) nor s3://, or download fails / exceeds limits
 */
export async function downloadHttpToFile(url: string, destPath: string): Promise<void> {
  const trimmed = url.trim();
  const max = maxDownloadBytes();

  // --- Path 1: explicit s3:// URI (no HTTP round-trip) ---
  const s3Direct = parseS3Uri(trimmed);
  if (s3Direct) {
    await downloadObjectToFileLimited(s3Direct.bucket, s3Direct.key, destPath, max);
    return;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Only http(s) URLs or s3://bucket/key are supported');
  }

  // --- Path 2: HTTP(S) fetch ---
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(trimmed, { redirect: 'follow', signal: ac.signal });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || (e as { name?: string })?.name === 'AbortError') {
      throw new Error(`Download timed out after ${FETCH_TIMEOUT_MS / 60000} minutes`);
    }
    throw new Error(`Download failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    // --- Path 3: S3 presigned URL expired/wrong verb → try server-side GetObject ---
    if (res.status === 403 && /AccessDenied/i.test(t) && sdkFallbackOn403Enabled()) {
      const parsed = tryParseS3HttpUrl(trimmed);
      if (parsed) {
        try {
          await downloadObjectToFileLimited(parsed.bucket, parsed.key, destPath, max);
          return;
        } catch (sdkErr: unknown) {
          const m = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
          throw new Error(
            `${accessDeniedHelp()} Original: ${t.slice(0, 200)}. SDK GetObject fallback failed: ${m}`
          );
        }
      }
    }
    if (res.status === 403 && /AccessDenied/i.test(t)) {
      throw new Error(`${accessDeniedHelp()} Response: ${t.slice(0, 500)}`);
    }
    throw new Error(`Download failed: ${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 300)}` : ''}`);
  }
  if (!res.body) {
    throw new Error('Empty response body');
  }

  // Reject upfront if Content-Length exceeds cap (before streaming).
  const cl = res.headers.get('content-length');
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > max) {
      throw new Error(`Remote file too large (${n} bytes, max ${max})`);
    }
  }

  // Stream response body to disk with a running byte counter (handles missing Content-Length).
  const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > max) {
        cb(new Error(`Download exceeded size limit (${max} bytes)`));
        return;
      }
      cb(null, chunk);
    },
  });
  const out = createWriteStream(destPath);
  try {
    await pipeline(stream, limiter, out);
  } catch (e) {
    await fs.unlink(destPath).catch(() => {});
    throw e;
  }

  // Final sanity check on written file.
  const stat = await fs.stat(destPath);
  if (stat.size < 32) {
    await fs.unlink(destPath).catch(() => {});
    throw new Error('Downloaded file too small or empty');
  }
  if (stat.size > max) {
    await fs.unlink(destPath).catch(() => {});
    throw new Error(`File too large (${stat.size} bytes)`);
  }
}
