import { createReadStream, createWriteStream } from 'fs';
import { unlink, stat } from 'fs/promises';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request, Response } from 'express';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function client(): S3Client {
  return new S3Client({
    // IMPORTANT:
    // - In Lambda, AWS_REGION is set automatically.
    // - In local dev, if AWS_REGION isn't set, defaulting to us-east-1 breaks presigned URLs
    //   for buckets in other regions (you'll see redirects / CORS failures in the browser).
    // Prefer explicit S3_REGION, then AWS_REGION, then a sensible default for this project.
    region:
      process.env.S3_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      'ap-south-1',
  });
}

export async function uploadFileToS3(
  bucket: string,
  key: string,
  filePath: string,
  contentType: string = 'video/mp4'
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    })
  );
}

/** True if an object exists at key (HeadObject succeeds). */
export async function objectExistsInS3(bucket: string, key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e: unknown) {
    const err = e as { $metadata?: { httpStatusCode?: number }; name?: string; Code?: string };
    const code = err?.Code || err?.name;
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') return false;
    throw e;
  }
}

/**
 * Upload local file to S3 only if the key does not already exist (idempotent PUT for inputs).
 * Returns whether an upload was performed.
 */
export async function uploadFileToS3IfAbsent(
  bucket: string,
  key: string,
  filePath: string,
  contentType: string = 'video/mp4'
): Promise<'uploaded' | 'skipped'> {
  if (await objectExistsInS3(bucket, key)) {
    return 'skipped';
  }
  await uploadFileToS3(bucket, key, filePath, contentType);
  return 'uploaded';
}

export async function deleteObjectFromS3(bucket: string, key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getPresignedGetUrl(bucket: string, key: string, expiresInSeconds = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
}

/**
 * Single bucket for user-uploaded story assets (video/audio/bgm).
 * Falls back to S3_OUTPUT_BUCKET so one env var can cover uploads + outputs.
 */
export function resolveUserUploadsBucket(): string | undefined {
  const u = process.env.S3_USER_UPLOADS_BUCKET?.trim();
  const o = process.env.S3_OUTPUT_BUCKET?.trim();
  return u || o || undefined;
}

/** Story / quiz outputs: prefer dedicated output bucket, else same as user uploads (single-bucket setups). */
export function resolveOutputBucket(): string | undefined {
  const o = process.env.S3_OUTPUT_BUCKET?.trim();
  const u = process.env.S3_USER_UPLOADS_BUCKET?.trim();
  return o || u || undefined;
}

/** Presigned PUT for browser/client direct upload to S3. */
export async function getPresignedPutUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresInSeconds = 3600
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
}

/** Stream an object through Express (supports Range) for <video> playback. */
export async function streamS3ObjectToHttpResponse(
  bucket: string,
  key: string,
  req: Request,
  res: Response
): Promise<void> {
  const range = req.headers.range;
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(typeof range === 'string' && range ? { Range: range } : {}),
  });
  try {
    const out = await client().send(cmd);
    const body = out.Body;
    if (!body) {
      res.status(500).json({ success: false, error: 'Empty S3 body' });
      return;
    }
    res.setHeader('Content-Type', out.ContentType || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (out.ContentRange) {
      res.status(206);
      res.setHeader('Content-Range', out.ContentRange);
    } else {
      res.status(200);
    }
    if (out.ContentLength != null) {
      res.setHeader('Content-Length', String(out.ContentLength));
    }
    const readable = body as Readable;
    readable.on('error', () => {
      if (!res.writableEnded) res.destroy();
    });
    res.on('close', () => {
      readable.destroy();
    });
    readable.pipe(res);
  } catch (e: unknown) {
    const err = e as { $metadata?: { httpStatusCode?: number }; Code?: string; name?: string };
    const status = err?.$metadata?.httpStatusCode;
    const code = err?.Code || err?.name;
    if (status === 404 || code === 'NoSuchKey' || code === 'NotFound') {
      if (!res.headersSent) {
        res.status(404).json({ success: false, error: 'Video file missing' });
      }
      return;
    }
    throw e;
  }
}

/** Stream an S3 object to a local file (no size limit). Used by MCQ/publish paths. */
export async function downloadObjectToFile(bucket: string, key: string, outPath: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) throw new Error('S3 GetObject returned empty body');
  // Body is a stream in Node runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readable = body as any;
  await pipeline(readable, createWriteStream(outPath));
}

/**
 * Stream an S3 object to disk with a byte cap and min-size check.
 *
 * Used by story downloadAsset.ts for s3:// URIs and SDK fallback after HTTP 403.
 * Deletes outPath on stream failure or if the result is smaller than 32 bytes.
 */
export async function downloadObjectToFileLimited(
  bucket: string,
  key: string,
  outPath: string,
  maxBytes: number
): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) throw new Error('S3 GetObject returned empty body');
  const cl = res.ContentLength;
  if (cl != null && cl > maxBytes) {
    throw new Error(`S3 object is ${cl} bytes (max ${maxBytes})`);
  }
  const readable = body as Readable;
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        cb(new Error(`Download exceeded size limit (${maxBytes} bytes)`));
        return;
      }
      cb(null, chunk);
    },
  });
  const out = createWriteStream(outPath);
  try {
    await pipeline(readable, limiter, out);
  } catch (e) {
    await unlink(outPath).catch(() => {});
    throw e;
  }
  const st = await stat(outPath);
  if (st.size < 32) {
    await unlink(outPath).catch(() => {});
    throw new Error('Downloaded file too small or empty');
  }
}
