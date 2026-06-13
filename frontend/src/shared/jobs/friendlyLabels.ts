const DEFAULT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'In progress',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  queued: 'Queued',
};

export const STORY_STAGE_LABELS: Record<string, string> = {
  queued: 'Waiting to start',
  ingest: 'Loading source files',
  scenes: 'Detecting scenes',
  transcribe: 'Transcribing narration',
  translate: 'Translating text',
  match: 'Matching narration to scenes',
  clips: 'Building timeline',
  audio_mix: 'Mixing audio',
  finalize: 'Adding subtitles & music',
  upload: 'Saving output',
  re_render: 'Re-rendering edits',
  completed: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const TRAILER_STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  download: 'Downloading trailer',
  transcribe: 'Transcribing audio',
  detect_scenes: 'Detecting scenes',
  generate_script: 'Writing breakdown script',
  render: 'Rendering video',
  re_render: 'Re-rendering',
  resume: 'Resuming',
  upload: 'Uploading',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function friendlyStatusLabel(status: string): string {
  return DEFAULT_STATUS_LABELS[status] || status;
}

export function friendlyStageLabel(stage: string, custom?: Record<string, string>): string {
  const key = stage.trim().toLowerCase();
  const map = custom ?? {};
  return map[key] || map[stage] || stage.replace(/_/g, ' ');
}
