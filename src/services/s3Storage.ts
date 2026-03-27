import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
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

export async function downloadObjectToFile(bucket: string, key: string, outPath: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) throw new Error('S3 GetObject returned empty body');
  // Body is a stream in Node runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readable = body as any;
  await pipeline(readable, createWriteStream(outPath));
}
