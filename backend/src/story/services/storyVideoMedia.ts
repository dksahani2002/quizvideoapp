import path from 'path';
import fs from 'fs';
import type { EnvConfig } from '../../common/config/envConfig.js';
import { parseS3Uri } from '../s3InputUri.js';

export function inferStoryUploadExt(kind: string, filename?: string): string {
  const fromName = path.extname(filename || '').toLowerCase();
  if (/^\.\w{1,8}$/.test(fromName)) {
    if (kind === 'video' && ['.mp4', '.mov', '.webm', '.mkv'].includes(fromName)) return fromName;
    if (kind === 'image' && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(fromName)) return fromName;
    if (
      kind !== 'video' &&
      kind !== 'image' &&
      ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(fromName)
    ) {
      return fromName;
    }
  }
  if (kind === 'image') return '.png';
  return kind === 'video' ? '.mp4' : '.mp3';
}

export function defaultContentTypeForExt(ext: string, kind: 'video' | 'audio' | 'image'): string {
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  if (map[e]) return map[e];
  if (kind === 'video') return 'video/mp4';
  if (kind === 'image') return 'image/png';
  return 'audio/mpeg';
}

export function allowDevAssetInputs(env: EnvConfig): boolean {
  return env.NODE_ENV === 'development';
}

export function storyProductionUsesRemoteUrlsOnly(env: EnvConfig): boolean {
  return env.NODE_ENV === 'production';
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function extFromAssetUrl(url: string, fallback: string): string {
  const s3 = parseS3Uri(url);
  if (s3) {
    const base = s3.key.split('/').pop() || '';
    const e = path.extname(base);
    if (e && e.length <= 8) return e;
    return fallback;
  }
  try {
    const e = path.extname(new URL(url).pathname);
    if (e && e.length <= 8) return e;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function cleanupMulterFiles(files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined): void {
  if (!files) return;
  const list = Array.isArray(files) ? files : Object.values(files).flat();
  for (const f of list) {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
  }
}

export function contentTypeForOriginalVideo(ext: string): string {
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

export function mediaKindFromExt(ext: string): 'video' | 'audio' | 'image' {
  const isImg = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
  if (isImg) return 'image';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  return 'audio';
}
