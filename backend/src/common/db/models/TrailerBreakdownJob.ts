import mongoose, { Schema, Document, Types } from 'mongoose';

export type TrailerBreakdownJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface BreakdownSegment {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  narration: string;
  onScreenText?: string;
}

export interface TrailerJobOptionsDoc {
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs' | 'system';
  /** OpenAI voice name, or ElevenLabs voice id when using those providers. */
  ttsVoice: string;
  ttsModel: string;
  /** macOS `say` voice when ttsProvider is system. */
  systemVoice: string;
  elevenlabsModelId: string;
  exportPreset: 'fast' | 'balanced' | 'quality';
  sceneDetectionMode: 'ffmpeg' | 'pyscenedetect' | 'hybrid';
  narrationLanguage: string;
  ffmpegSceneThreshold: number;
}

export interface TrailerJobEvent {
  at: Date;
  stage: string;
  message: string;
}

export interface TrailerIntermediateMeta {
  workDir?: string;
  sourceVideoPath?: string;
  transcriptJson?: string;
  sceneCutsJson?: string;
  breakdownScriptJson?: string;
  narrationAudioPath?: string;
  clipsDir?: string;
  finalPath?: string;
  videoTitle?: string;
}

export interface ITrailerBreakdownJob extends Document {
  userId: Types.ObjectId;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  status: TrailerBreakdownJobStatus;
  stage: string;
  progressMessage: string;
  progressPercent: number;
  cancelRequested: boolean;
  youtubeUrl: string;
  movieTitle: string;
  breakdownTitle: string;
  options: TrailerJobOptionsDoc;
  breakdownScript: BreakdownSegment[];
  outputVideoUrl: string;
  outputVideoKey: string;
  s3Bucket: string;
  error: string;
  intermediate: TrailerIntermediateMeta;
  events: TrailerJobEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const segmentSchema = new Schema<BreakdownSegment>(
  {
    id: { type: String, required: true },
    startSec: { type: Number, required: true },
    endSec: { type: Number, required: true },
    label: { type: String, default: '' },
    narration: { type: String, default: '' },
    onScreenText: { type: String, default: '' },
  },
  { _id: false }
);

const optionsSchema = new Schema<TrailerJobOptionsDoc>(
  {
    ttsProvider: {
      type: String,
      enum: ['inherit', 'openai', 'elevenlabs', 'system'],
      default: 'inherit',
    },
    ttsVoice: { type: String, default: '' },
    ttsModel: { type: String, default: 'tts-1' },
    systemVoice: { type: String, default: '' },
    elevenlabsModelId: { type: String, default: '' },
    exportPreset: {
      type: String,
      enum: ['fast', 'balanced', 'quality'],
      default: 'balanced',
    },
    sceneDetectionMode: {
      type: String,
      enum: ['ffmpeg', 'pyscenedetect', 'hybrid'],
      default: 'ffmpeg',
    },
    narrationLanguage: { type: String, default: 'en' },
    ffmpegSceneThreshold: { type: Number, default: 0.32 },
  },
  { _id: false }
);

const eventSchema = new Schema<TrailerJobEvent>(
  {
    at: { type: Date, required: true },
    stage: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false }
);

const trailerBreakdownJobSchema = new Schema<ITrailerBreakdownJob>(
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
    youtubeUrl: { type: String, required: true },
    movieTitle: { type: String, default: '' },
    breakdownTitle: { type: String, default: '' },
    options: { type: optionsSchema, default: () => ({}) },
    breakdownScript: { type: [segmentSchema], default: [] },
    outputVideoUrl: { type: String, default: '' },
    outputVideoKey: { type: String, default: '' },
    s3Bucket: { type: String, default: '' },
    error: { type: String, default: '' },
    intermediate: { type: Schema.Types.Mixed, default: {} },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);

trailerBreakdownJobSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $type: 'string', $ne: '' },
    },
  }
);

export const TrailerBreakdownJob = mongoose.model<ITrailerBreakdownJob>(
  'TrailerBreakdownJob',
  trailerBreakdownJobSchema
);
