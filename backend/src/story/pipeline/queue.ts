/**
 * Story-video job queue dispatcher.
 *
 * Invokes `STORY_VIDEO_WORKER_FUNCTION_NAME` Lambda when set; otherwise runs
 * {@link runStoryVideoJob} in-process. Callers: queueStoryVideoJob.ts, routes, retry logic.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * Enqueue a story-video job for background processing.
 *
 * Same pattern as MCQ `queueVideoJob`: Lambda Event invoke or fire-and-forget local run.
 */
export async function queueStoryVideoJob(jobId: string): Promise<void> {
  const fn = process.env.STORY_VIDEO_WORKER_FUNCTION_NAME?.trim();
  if (fn) {
    const client = new LambdaClient({});
    await client.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ storyVideoJobId: jobId })),
      })
    );
    return;
  }
  const { runStoryVideoJob } = await import('./run.js');
  void runStoryVideoJob(jobId);
}
