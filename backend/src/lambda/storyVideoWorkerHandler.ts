import type { Handler } from "aws-lambda";

import "dotenv/config";
import { loadEnvConfig, assertProductionConfig } from "../common/config/envConfig.js";
import { initDatabase } from "../common/db/connection.js";
import { runStoryVideoJob } from "../story/pipeline.js";

type WorkerEvent = { storyVideoJobId?: string };

export const handler: Handler = async (event: WorkerEvent) => {
  const storyVideoJobId = event?.storyVideoJobId;
  if (!storyVideoJobId || typeof storyVideoJobId !== "string") {
    console.error("storyVideoWorkerHandler: missing storyVideoJobId", event);
    return { statusCode: 400, body: JSON.stringify({ error: "missing storyVideoJobId" }) };
  }

  assertProductionConfig(loadEnvConfig());
  await initDatabase();
  await runStoryVideoJob(storyVideoJobId);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
