/**
 * Video generation job entry points (in-process worker).
 * Implementation lives under `src/videoJob/` so new pipeline steps stay isolated.
 */
export { runVideoJob } from '../../mcq/videoJob/runVideoJob.js';
export { retryStuckJobs } from '../../mcq/videoJob/retryStuckJobs.js';
