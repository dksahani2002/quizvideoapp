import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUpload extends Document {
  userId: Types.ObjectId;
  filename: string;
  filePath: string;
  createdAt: Date;
}

const uploadSchema = new Schema<IUpload>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  filename: { type: String, required: true },
  filePath: { type: String, required: true },
}, { timestamps: true });

export const Upload = mongoose.model<IUpload>('Upload', uploadSchema);
