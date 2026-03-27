import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request, Response } from 'express';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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

export async function uploadFileToS3(bucket: string, key: string, filePath: string): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: 'video/mp4',
    })
  );
}

export async function deleteObjectFromS3(bucket: string, key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getPresignedGetUrl(bucket: string, key: string, expiresInSeconds = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
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

export async function downloadObjectToFile(bucket: string, key: string, outPath: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) throw new Error('S3 GetObject returned empty body');
  // Body is a stream in Node runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readable = body as any;
  await pipeline(readable, createWriteStream(outPath));
}
