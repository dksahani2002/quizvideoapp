import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUserSettings extends Document {
  userId: Types.ObjectId;
  /** Legacy plaintext settings (non-encrypted). */
  settingsJson?: string;
  /** Encrypted settings blob (JSON envelope). */
  settingsEnc?: string;
  /** Schema version for migrations. */
  schemaVersion?: number;
}

const userSettingsSchema = new Schema<IUserSettings>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  settingsJson: { type: String, required: false },
  settingsEnc: { type: String, required: false },
  schemaVersion: { type: Number, required: false, default: 1 },
}, { timestamps: true });

export const UserSettings = mongoose.model<IUserSettings>('UserSettings', userSettingsSchema);
