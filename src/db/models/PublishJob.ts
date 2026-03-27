import mongoose, { Schema, Document, Types } from 'mongoose';

export type PublishPlatform = 'youtube' | 'instagram';
export type PublishStatus = 'scheduled' | 'running' | 'published' | 'failed';

export interface IPublishJob extends Document {
  userId: Types.ObjectId;
  videoId: Types.ObjectId;
  platform: PublishPlatform;
  scheduledAt: Date;
  status: PublishStatus;
  attempts: number;
  lastError?: string;
  resultJson?: string;
  createdAt: Date;
  updatedAt: Date;
}

const publishJobSchema = new Schema<IPublishJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
    platform: { type: String, enum: ['youtube', 'instagram'], required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['scheduled', 'running', 'published', 'failed'], default: 'scheduled', index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    resultJson: { type: String, default: '' },
  },
  { timestamps: true }
);

export const PublishJob = mongoose.model<IPublishJob>('PublishJob', publishJobSchema);

