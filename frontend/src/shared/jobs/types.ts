export type JobStatusShape = {
  status: string;
  stage?: string;
  progressMessage?: string;
  progressPercent: number;
  error?: string;
};
