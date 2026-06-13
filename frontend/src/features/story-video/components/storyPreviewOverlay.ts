import type { StoryClip } from '../api';
import { apiUrlWithTokenForMedia } from '../../../lib/mediaUrl';
import { clipIndexAtProgramTimeSec } from './storyTimelineUtils';

export type PreviewImageOverlay = {
  url: string;
  fullFrame: boolean;
  position: NonNullable<StoryClip['overlayPosition']>;
  opacity: number;
};

/** Matches backend `overlayWatermark`: ~14% width, 24px margin from edges. */
export const PREVIEW_OVERLAY_CORNER_CLASS: Record<
  NonNullable<StoryClip['overlayPosition']>,
  string
> = {
  'top-left':
    'absolute top-6 left-6 w-[14%] max-w-[min(180px,14vw)] h-auto object-contain pointer-events-none select-none',
  'top-right':
    'absolute top-6 right-6 w-[14%] max-w-[min(180px,14vw)] h-auto object-contain pointer-events-none select-none',
  'bottom-left':
    'absolute bottom-6 left-6 w-[14%] max-w-[min(180px,14vw)] h-auto object-contain pointer-events-none select-none',
  'bottom-right':
    'absolute bottom-6 right-6 w-[14%] max-w-[min(180px,14vw)] h-auto object-contain pointer-events-none select-none',
};

export function activeClipImageOverlayAtTime(
  clips: StoryClip[],
  programTimeSec: number
): PreviewImageOverlay | null {
  const idx = clipIndexAtProgramTimeSec(clips, programTimeSec);
  if (idx == null) return null;
  const c = clips[idx];
  const raw = c?.overlayImageUrl?.trim();
  if (!raw) return null;
  return {
    url: apiUrlWithTokenForMedia(raw),
    fullFrame: c?.overlayImageOverridesClip === true,
    position: c?.overlayPosition ?? 'bottom-right',
    opacity: c?.overlayOpacity ?? 0.85,
  };
}
