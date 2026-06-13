/**
 * Shared TypeScript types for the story-video pipeline.
 *
 * {@link NarrationSegment} — voiceover lines with optional Whisper timings.
 * {@link SceneSegment} — detected video scenes with dialogue text.
 * {@link WhisperSegment} — raw Whisper verbose_json segment.
 */
export type NarrationSegment = {
  index: number;
  text: string;
  /** Whisper / source language text before translation to English (when translateToEnglish ran). */
  textOriginal?: string;
  startSec?: number;
  endSec?: number;
};

export type SceneSegment = {
  index: number;
  start: number;
  end: number;
  text: string;
  /** Video dialogue in the original language before English translation for the editor. */
  textOriginal?: string;
};

export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};
