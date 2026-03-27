import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.me'
  | 'settings.get'
  | 'settings.update'
  | 'videos.generate'
  | 'videos.list'
  | 'videos.play'
  | 'videos.download'
  | 'videos.delete'
  | 'jobs.get'
  | 'jobs.cancel'
  | 'jobs.retry'
  | 'publish.youtube.connect_url'
  | 'publish.youtube.callback'
  | 'publish.instagram.connect_url'
  | 'publish.instagram.callback'
  | 'publish.schedule'
  | 'publish.run_due'
  | 'analytics.summary'
  | 'analytics.youtube.refresh'
  | 'admin.audit.query'
  | 'admin.users.list';

export interface IAuditEvent extends Document {
  userId?: Types.ObjectId;
  action: AuditAction;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  error?: string;
  meta?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const auditEventSchema = new Schema<IAuditEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    action: { type: String, required: true, index: true },
    method: { type: String, required: true },
    path: { type: String, required: true, index: true },
    ip: { type: String, required: true },
    userAgent: { type: String, required: true },
    statusCode: { type: Number, required: true, index: true },
    durationMs: { type: Number, required: true },
    error: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true }
);

auditEventSchema.index({ createdAt: -1 });

export const AuditEvent = mongoose.model<IAuditEvent>('AuditEvent', auditEventSchema);

