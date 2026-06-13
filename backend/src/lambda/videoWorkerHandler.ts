import type { Handler } from "aws-lambda";

import "dotenv/config";
import { loadEnvConfig, assertProductionConfig } from "../common/config/envConfig.js";
import { initDatabase } from "../common/db/connection.js";
import { runVideoJob } from "../mcq/videoJob/jobRunner.js";

type WorkerEvent = { videoId?: string };

export const handler: Handler = async (event: WorkerEvent) => {
  const videoId = event?.videoId;
  if (!videoId || typeof videoId !== "string") {
    console.error("videoWorkerHandler: missing videoId", event);
    return { statusCode: 400, body: JSON.stringify({ error: "missing videoId" }) };
  }

  assertProductionConfig(loadEnvConfig());
  await initDatabase();
  await runVideoJob(videoId);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
