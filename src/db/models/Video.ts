import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IVideo extends Document {
  userId: Types.ObjectId;
  jobId: string;
  requestJson?: string;
  filename: string;
  filePath: string;
  /** When set (e.g. AWS Lambda + S3), video is served via presigned URLs. */
  s3Bucket?: string;
  s3Key?: string;
  size: number;
  status: 'generating' | 'completed' | 'failed';
  progressStage?: string;
  progressMessage?: string;
  attempts: number;
  lastError?: string;
  createdAt: Date;
}

const videoSchema = new Schema<IVideo>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: String, required: true },
  requestJson: { type: String, default: '' },
  filename: { type: String, required: true },
  filePath: { type: String, required: true },
  s3Bucket: { type: String, default: '' },
  s3Key: { type: String, default: '' },
  size: { type: Number, default: 0 },
  status: { type: String, enum: ['generating', 'completed', 'failed'], default: 'generating' },
  progressStage: { type: String, default: '' },
  progressMessage: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
}, { timestamps: true });

export const Video = mongoose.model<IVideo>('Video', videoSchema);
