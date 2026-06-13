import mongoose, { Schema, Document, Types } from 'mongoose';

export type StoryVideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/** Normalized crop rectangle on the source frame (0–1). Omitted = full frame. */
export interface StoryClipCropNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoryTimelineClip {
  id: string;
  start: number;
  end: number;
  text: string;
  narrationIndex?: number;
  sceneIndex?: number;
  videoUrl?: string;
  trimStart?: number;
  trimEnd?: number;
  /** Override: start time in the original upload used for this clip’s video (seconds). */
  sourceInSec?: number;
  /**
   * Seconds of source footage to decode from `sourceInSec` (or default in-point).
   * If longer than the clip’s timeline duration, only the first part is used (trim from start).
   */
  sourceTakeSec?: number;
  /** Spatial crop on source; scaled/padded back to project frame size for concat. */
  cropNorm?: StoryClipCropNorm;
  /**
   * Exported program length for this clip (seconds). When set (e.g. from narration), picture is padded or trimmed
   * to match voice; `end - start` stays the source window used from the upload (≤ scene length).
   */
  programDurationSec?: number;
  overlayImageUrl?: string;
  /** When set with `overlayImageUrl`, the image fills the clip instead of a corner watermark. */
  overlayImageOverridesClip?: boolean;
  overlayText?: string;
  overlayPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlayOpacity?: number;
}

export interface StoryEditorImageAsset {
  id: string;
  url: string;
  name: string;
}

export interface StoryTimeline {
  clips: StoryTimelineClip[];
  /** User-uploaded images for drag-to-clip overlays (HTTPS URLs). */
  imageLibrary?: StoryEditorImageAsset[];
}

export interface StoryJobOptionsDoc {
  sceneDetectionMode: 'ffmpeg' | 'pyscenedetect' | 'hybrid';
  subtitleMode: 'none' | 'burn_in' | 'sidecar_srt' | 'both';
  bgmVolume: number;
  exportPreset: 'fast' | 'balanced' | 'quality';
  narrationLanguage: string;
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs';
  pySceneThreshold: number;
  ffmpegSceneThreshold: number;
  narrationSceneMatchMode: 'embeddings' | 'sequential';
  translateToEnglish: boolean;
}

export interface StoryJobEvent {
  at: Date;
  stage: string;
  message: string;
}

export interface StoryIntermediateMeta {
  workDir?: string;
  narrationSegmentsJson?: string;
  sceneCutsJson?: string;
  videoTranscriptSegmentsJson?: string;
  clipsDir?: string;
  mergedPath?: string;
  finalSrtPath?: string;
  finalPath?: string;
  scenesJson?: string;
  /** Whisper-reported language codes for the video track and narration track. */
  detectedVideoLanguage?: string;
  detectedNarrationLanguage?: string;
  /**
   * Hash of narration sources + per-clip audio layout; when unchanged, re-render can reuse
   * `final_narration.mp3` instead of rebuilding.
   */
  narrationRerenderFingerprint?: string;
}

export interface IStoryVideoJob extends Document {
  userId: Types.ObjectId;
  /** Optional client key for idempotent create (same user + key → same job while active). */
  idempotencyKey: string;
  /** Number of pipeline runs started (incremented each time the worker runs). */
  attempts: number;
  /** Max automatic pipeline runs; default from env at job creation. */
  maxAttempts: number;
  status: StoryVideoJobStatus;
  stage: string;
  progressMessage: string;
  progressPercent: number;
  cancelRequested: boolean;
  inputVideoUrl: string;
  inputVideoKey: string;
  inputVideoLocalPath: string;
  inputAudioUrl: string;
  inputAudioKey: string;
  inputAudioLocalPath: string;
  scriptText: string;
  bgmLocalPath: string;
  bgmKey: string;
  bgmUrl: string;
  options: StoryJobOptionsDoc;
  timeline: StoryTimeline;
  outputVideoUrl: string;
  outputVideoKey: string;
  outputSrtKey: string;
  s3Bucket: string;
  error: string;
  intermediate: StoryIntermediateMeta;
  events: StoryJobEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const imageLibraryItemSchema = new Schema<StoryEditorImageAsset>(
  {
    id: { type: String, required: true },
    url: { type: String, required: true },
    name: { type: String, default: '' },
  },
  { _id: false }
);

const cropNormSchema = new Schema<StoryClipCropNorm>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    w: { type: Number, required: true },
    h: { type: Number, required: true },
  },
  { _id: false }
);

const clipSchema = new Schema<StoryTimelineClip>(
  {
    id: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, default: '' },
    narrationIndex: { type: Number },
    sceneIndex: { type: Number },
    videoUrl: { type: String, default: '' },
    trimStart: { type: Number },
    trimEnd: { type: Number },
    sourceInSec: { type: Number },
    sourceTakeSec: { type: Number },
    cropNorm: { type: cropNormSchema },
    programDurationSec: { type: Number },
    overlayImageUrl: { type: String, default: '' },
    overlayImageOverridesClip: { type: Boolean, default: false },
    overlayText: { type: String, default: '' },
    overlayPosition: {
      type: String,
      enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    },
    overlayOpacity: { type: Number },
  },
  { _id: false }
);

const optionsSchema = new Schema<StoryJobOptionsDoc>(
  {
    sceneDetectionMode: {
      type: String,
      enum: ['ffmpeg', 'pyscenedetect', 'hybrid'],
      default: 'hybrid',
    },
    subtitleMode: {
      type: String,
      enum: ['none', 'burn_in', 'sidecar_srt', 'both'],
      default: 'both',
    },
    bgmVolume: { type: Number, default: 0.14 },
    exportPreset: {
      type: String,
      enum: ['fast', 'balanced', 'quality'],
      default: 'balanced',
    },
    narrationLanguage: { type: String, default: 'en' },
    ttsProvider: {
      type: String,
      enum: ['inherit', 'openai', 'elevenlabs'],
      default: 'inherit',
    },
    pySceneThreshold: { type: Number, default: 27 },
    ffmpegSceneThreshold: { type: Number, default: 0.32 },
    narrationSceneMatchMode: {
      type: String,
      enum: ['embeddings', 'sequential'],
      default: 'embeddings',
    },
    translateToEnglish: { type: Boolean, default: true },
  },
  { _id: false }
);

const eventSchema = new Schema<StoryJobEvent>(
  {
    at: { type: Date, required: true },
    stage: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false }
);

const storyVideoJobSchema = new Schema<IStoryVideoJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    idempotencyKey: { type: String, default: '' },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    stage: { type: String, default: '' },
    progressMessage: { type: String, default: '' },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    cancelRequested: { type: Boolean, default: false },
    inputVideoUrl: { type: String, default: '' },
    inputVideoKey: { type: String, default: '' },
    inputVideoLocalPath: { type: String, default: '' },
    inputAudioUrl: { type: String, default: '' },
    inputAudioKey: { type: String, default: '' },
    inputAudioLocalPath: { type: String, default: '' },
    scriptText: { type: String, default: '' },
    bgmLocalPath: { type: String, default: '' },
    bgmKey: { type: String, default: '' },
    bgmUrl: { type: String, default: '' },
    options: { type: optionsSchema, default: () => ({}) },
    timeline: {
      clips: { type: [clipSchema], default: [] },
      imageLibrary: { type: [imageLibraryItemSchema], default: undefined },
    },
    outputVideoUrl: { type: String, default: '' },
    outputVideoKey: { type: String, default: '' },
    outputSrtKey: { type: String, default: '' },
    s3Bucket: { type: String, default: '' },
    error: { type: String, default: '' },
    intermediate: { type: Schema.Types.Mixed, default: {} },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);

storyVideoJobSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $type: 'string', $ne: '' },
    },
  }
);

export const StoryVideoJob = mongoose.model<IStoryVideoJob>('StoryVideoJob', storyVideoJobSchema);
