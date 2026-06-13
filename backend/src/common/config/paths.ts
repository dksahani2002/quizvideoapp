import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** `backend/` — contains `src/`, `assets/`, build output `dist/`, etc. */
export const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/** Monorepo root — contains `frontend/` and `backend/`. */
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

export const ASSETS_DIR = path.join(BACKEND_ROOT, 'assets');

export function frontendDistPath(): string {
  return path.join(REPO_ROOT, 'frontend', 'dist');
}

/** Resolve a path under `backend/assets/`. */
export function assetPath(...segments: string[]): string {
  return path.join(ASSETS_DIR, ...segments);
}

/**
 * Resolve a relative path to a regular file under `backend/assets/` (no `..`, no absolute paths).
 * Used for dev-only story inputs (`devVideoAsset` / `devAudioAsset` on POST /story-video/create).
 */
export function resolvePathUnderAssetsDir(rel: string): string | null {
  const relNorm = rel.trim().replace(/^[/\\]+/, '');
  if (!relNorm || relNorm.includes('..')) return null;
  const abs = path.resolve(ASSETS_DIR, relNorm);
  const root = path.resolve(ASSETS_DIR);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}
