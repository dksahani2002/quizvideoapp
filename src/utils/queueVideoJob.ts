import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * On AWS, the API Lambda must not run video rendering in-process (the runtime freezes after the HTTP response).
 * Set VIDEO_WORKER_FUNCTION_NAME to the worker Lambda name so jobs are invoked asynchronously.
 * Dynamic-imports jobRunner to avoid a circular dependency with retryStuckJobs.
 */
export async function queueVideoJob(videoId: string): Promise<void> {
  const fn = process.env.VIDEO_WORKER_FUNCTION_NAME?.trim();
  if (fn) {
    const client = new LambdaClient({});
    await client.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ videoId })),
      })
    );
    return;
  }
  const { runVideoJob } = await import('./jobRunner.js');
  void runVideoJob(videoId);
}
