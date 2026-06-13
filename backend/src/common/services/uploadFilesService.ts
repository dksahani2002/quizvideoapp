import path from 'path';
import fs from 'fs';
import type { EnvConfig } from '../config/envConfig.js';
import { Upload } from '../db/models/Upload.js';

export type UploadBackgroundResult =
  | { kind: 'ok'; path: string; url: string }
  | { kind: 'bad_request'; error: string }
  | { kind: 'error'; error: string };

export async function uploadBackgroundFile(userId: string, body: any, env: EnvConfig): Promise<UploadBackgroundResult> {
  try {
    const { image, filename } = body;
    if (!image || !filename) {
      return { kind: 'bad_request', error: 'image and filename required' };
    }

    const userUploadDir = path.resolve(path.join(env.UPLOADS_DIR, userId));
    if (!fs.existsSync(userUploadDir)) fs.mkdirSync(userUploadDir, { recursive: true });

    const base64Data = String(image).replace(/^data:image\/\w+;base64,/, '');
    const outPath = path.join(userUploadDir, String(filename));
    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));

    await Upload.create({ userId, filename: String(filename), filePath: outPath });

    return { kind: 'ok', path: outPath, url: `/api/uploads/files/${userId}/${String(filename)}` };
  } catch (error) {
    return { kind: 'error', error: String(error) };
  }
}

export type GetUploadedFileResult =
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'ok'; filePath: string };

export function resolveUploadedFilePath(
  userId: string,
  requestedUserId: string,
  filename: string,
  env: EnvConfig
): GetUploadedFileResult {
  if (userId !== requestedUserId) {
    return { kind: 'forbidden' };
  }
  const filePath = path.resolve(env.UPLOADS_DIR, userId, filename);
  if (!fs.existsSync(filePath)) {
    return { kind: 'not_found' };
  }
  return { kind: 'ok', filePath };
}
