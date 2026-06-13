/**
 * Trailer breakdown job queue dispatcher.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export async function queueTrailerBreakdownJob(
  jobId: string,
  opts: import('./run.js').RunTrailerOptions = {}
): Promise<void> {
  const fn = process.env.TRAILER_BREAKDOWN_WORKER_FUNCTION_NAME?.trim();
  if (fn) {
    const client = new LambdaClient({});
    await client.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ trailerBreakdownJobId: jobId, ...opts })),
      })
    );
    return;
  }
  const { runTrailerBreakdownJob } = await import('./run.js');
  void runTrailerBreakdownJob(jobId, opts);
}
