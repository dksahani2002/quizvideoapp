/**
 * S3 URI / URL parsers for story input downloads.
 *
 * Used by downloadAsset.ts to turn user-provided strings into `{ bucket, key }`
 * before calling s3Storage.downloadObjectToFileLimited.
 *
 * Re-exported from `story/s3InputUri.ts` for route-level validation.
 */

/**
 * Parse an s3:// URI into bucket and object key.
 *
 * Use when the client passes `s3://my-bucket/path/to/file.mp4` directly.
 * Key may contain slashes; returns null for malformed input.
 *
 * @example parseS3Uri('s3://bucket/folder/video.mp4') → { bucket: 'bucket', key: 'folder/video.mp4' }
 */
export function parseS3Uri(input: string): { bucket: string; key: string } | null {
  const s = input.trim();
  if (!s.toLowerCase().startsWith('s3://')) return null;
  const rest = s.slice(5);
  const i = rest.indexOf('/');
  if (i <= 0) return null;
  const bucket = rest.slice(0, i);
  const key = rest.slice(i + 1);
  if (!bucket || !key) return null;
  return { bucket, key: decodeURIComponent(key.replace(/\+/g, ' ')) };
}

/**
 * Parse a public or presigned S3 HTTPS URL into bucket and key.
 *
 * Use after an HTTP GET returns 403 AccessDenied — downloadAsset retries via AWS SDK
 * when the server has s3:GetObject on that object.
 *
 * Supports path-style, virtual-hosted, S3 Express, and legacy amazonaws.com host patterns.
 * Returns null if the URL is not a recognizable S3 endpoint.
 */
export function tryParseS3HttpUrl(input: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname;
    const rawPath = u.pathname.replace(/^\/+/, '');
    if (!rawPath) return null;

    // Path-style: s3.<region>.amazonaws.com/<bucket>/<key> or s3.amazonaws.com/<bucket>/<key>
    if (
      host === 's3.amazonaws.com' ||
      /^s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(host)
    ) {
      const parts = rawPath.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { bucket: parts[0], key: parts.slice(1).join('/') };
      }
      return null;
    }

    // Virtual-hosted: <bucket>.s3.<region>.amazonaws.com/<key>
    const vhRegional = host.match(
      /^([^.]+)\.s3(?:\.dualstack)?\.([a-z0-9-]+)\.amazonaws\.com$/i
    );
    if (vhRegional) {
      return { bucket: vhRegional[1], key: decodeURIComponent(rawPath) };
    }

    // S3 Express One Zone (directory bucket) presigned URLs:
    // <bucket>.s3express-<azId>.<region>.amazonaws.com/<key>
    const vhExpress = host.match(
      /^([^.]+)\.s3express-([a-z0-9-]+)\.([a-z0-9-]+)\.amazonaws\.com$/i
    );
    if (vhExpress) {
      return { bucket: vhExpress[1], key: decodeURIComponent(rawPath) };
    }

    // Legacy: <bucket>.s3.amazonaws.com/<key> (us-east-1)
    const vhLegacy = host.match(/^([^.]+)\.s3\.amazonaws\.com$/i);
    if (vhLegacy) {
      return { bucket: vhLegacy[1], key: decodeURIComponent(rawPath) };
    }
  } catch {
    return null;
  }
  return null;
}
