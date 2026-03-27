import mongoose, { Schema, Document, Types } from 'mongoose';

export type VideoJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface IVideoJobEvent {
  at: Date;
  stage: string;
  message: string;
}

export interface IVideoJob extends Document {
  userId: Types.ObjectId;
  videoId: Types.ObjectId;
  status: VideoJobStatus;
  attempts: number;
  cancelRequested: boolean;
  inputHash: string;
  stage: string;
  message: string;
  events: IVideoJobEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IVideoJobEvent>(
  {
    at: { type: Date, required: true },
    stage: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false }
);

const videoJobSchema = new Schema<IVideoJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed', 'cancelled'], default: 'queued', index: true },
    attempts: { type: Number, default: 0 },
    cancelRequested: { type: Boolean, default: false },
    inputHash: { type: String, default: '' },
    stage: { type: String, default: '' },
    message: { type: String, default: '' },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);

export const VideoJob = mongoose.model<IVideoJob>('VideoJob', videoJobSchema);

