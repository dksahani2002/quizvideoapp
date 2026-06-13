/**
 * Story job options: defaults, parsing, and export encode presets.
 *
 * Merged from request body on job create; persisted on `StoryVideoJob.options`.
 * Callers: storyVideoRoutes.ts, pipeline/run.ts
 */
export type StorySceneDetectionMode = 'ffmpeg' | 'pyscenedetect' | 'hybrid';

export type StorySubtitleMode = 'none' | 'burn_in' | 'sidecar_srt' | 'both';

export type StoryExportPreset = 'fast' | 'balanced' | 'quality';

/** How narration lines are paired with video scenes after scene detection. */
export type NarrationSceneMatchMode = 'embeddings' | 'sequential';

export interface StoryJobOptions {
  sceneDetectionMode: StorySceneDetectionMode;
  subtitleMode: StorySubtitleMode;
  /** Background music level under voice (0–0.35 typical). */
  bgmVolume: number;
  exportPreset: StoryExportPreset;
  /** BCP-47 / ISO language hint for TTS (e.g. en, hi). */
  narrationLanguage: string;
  /** Override app Settings TTS provider when `inherit`. */
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs';
  /** PySceneDetect content threshold (default 27). Lower = more cuts. */
  pySceneThreshold: number;
  /** FFmpeg scene filter sensitivity (0–1). */
  ffmpegSceneThreshold: number;
  /**
   * `embeddings`: match by text similarity (works when narration and video dialogue share a language).
   * `sequential`: spread narration lines across scenes in order (use for voiceover in a different language than the video).
   */
  narrationSceneMatchMode: NarrationSceneMatchMode;
  /** Translate detected scene + narration text to English for the editor, subtitles, and embedding match. */
  translateToEnglish: boolean;
}

/** Default story job options applied when the client omits or partially sends `options`. */
export const DEFAULT_STORY_OPTIONS: StoryJobOptions = {
  sceneDetectionMode: 'hybrid',
  subtitleMode: 'both',
  bgmVolume: 0.14,
  exportPreset: 'balanced',
  narrationLanguage: 'en',
  ttsProvider: 'inherit',
  pySceneThreshold: 27,
  ffmpegSceneThreshold: 0.32,
  narrationSceneMatchMode: 'embeddings',
  translateToEnglish: true,
};

const MATCH_MODES: NarrationSceneMatchMode[] = ['embeddings', 'sequential'];

function normalizeNarrationSceneMatchMode(
  v: unknown,
  fallback: NarrationSceneMatchMode
): NarrationSceneMatchMode {
  return typeof v === 'string' && MATCH_MODES.includes(v as NarrationSceneMatchMode)
    ? (v as NarrationSceneMatchMode)
    : fallback;
}

/** Merge partial options with {@link DEFAULT_STORY_OPTIONS} and clamp numeric fields. */
export function mergeStoryOptions(partial?: Partial<StoryJobOptions> | null): StoryJobOptions {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_STORY_OPTIONS };
  return {
    ...DEFAULT_STORY_OPTIONS,
    ...partial,
    narrationSceneMatchMode: normalizeNarrationSceneMatchMode(
      partial.narrationSceneMatchMode,
      DEFAULT_STORY_OPTIONS.narrationSceneMatchMode
    ),
    translateToEnglish:
      typeof partial.translateToEnglish === 'boolean'
        ? partial.translateToEnglish
        : DEFAULT_STORY_OPTIONS.translateToEnglish,
    bgmVolume: clamp(partial.bgmVolume ?? DEFAULT_STORY_OPTIONS.bgmVolume, 0, 0.45),
    pySceneThreshold: clamp(partial.pySceneThreshold ?? DEFAULT_STORY_OPTIONS.pySceneThreshold, 5, 100),
    ffmpegSceneThreshold: clamp(partial.ffmpegSceneThreshold ?? DEFAULT_STORY_OPTIONS.ffmpegSceneThreshold, 0.05, 0.9),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Parse `options` from a create-job request body (JSON string or object). */
export function parseStoryOptionsFromBody(raw: unknown): StoryJobOptions {
  if (raw == null || raw === '') return { ...DEFAULT_STORY_OPTIONS };
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      return mergeStoryOptions(j as Partial<StoryJobOptions>);
    } catch {
      return { ...DEFAULT_STORY_OPTIONS };
    }
  }
  if (typeof raw === 'object') {
    return mergeStoryOptions(raw as Partial<StoryJobOptions>);
  }
  return { ...DEFAULT_STORY_OPTIONS };
}

/** Map export preset to ffmpeg libx264 CRF, preset, and AAC bitrate. Caller: pipeline/finalize.ts */
export function getEncodeParams(preset: StoryExportPreset): { crf: string; preset: string; audioBitrate: string } {
  switch (preset) {
    case 'fast':
      return { crf: '24', preset: 'veryfast', audioBitrate: '160k' };
    case 'quality':
      return { crf: '18', preset: 'slow', audioBitrate: '256k' };
    case 'balanced':
    default:
      return { crf: '21', preset: 'medium', audioBitrate: '192k' };
  }
}
