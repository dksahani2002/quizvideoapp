import type { VideoTheme } from '../types/index.js';

/**
 * Shallow-merge quiz theme with intro/outro-specific overrides.
 * Omitted keys in `override` keep values from `base`.
 */
export function mergeVideoTheme(
  base: VideoTheme | undefined,
  override: Partial<VideoTheme> | undefined
): VideoTheme | undefined {
  if (!base && !override) return undefined;
  return { ...(base || {}), ...(override || {}) };
}
