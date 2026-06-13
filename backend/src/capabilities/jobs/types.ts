export type JobEvent = { at: Date; stage: string; message: string };

export type JobProgressFields = {
  progressPercent: number;
  stage: string;
  progressMessage: string;
  events?: JobEvent[];
  status: string;
  cancelRequested?: boolean;
  idempotencyKey?: string;
  error?: string;
  save(): Promise<unknown>;
};

export type RetryableJobFields = JobProgressFields & {
  attempts: number;
  maxAttempts?: number;
};
