import type { Handler } from "aws-lambda";
import serverlessExpress from "@codegenie/serverless-express";

import "dotenv/config";
import { loadEnvConfig, assertProductionConfig } from "../config/envConfig.js";
import { initDatabase } from "../db/connection.js";
import { createApp } from "../app.js";

let cached: Handler | undefined;

export const handler: Handler = async (event, context, callback) => {
  if (!cached) {
    process.env.NODE_ENV = process.env.NODE_ENV || "production";
    const env = loadEnvConfig();
    assertProductionConfig(env);
    await initDatabase();
    // Keep API Lambda cold-start lean. Stuck-job retry is optional and lazy-loaded.
    // The heavy job runner import graph can cause init timeouts in Lambda.
    if (process.env.SKIP_STUCK_RETRY_ON_COLD_START === "0") {
      const { retryStuckJobs } = await import("../utils/jobRunner.js");
      await retryStuckJobs();
    }
    const app = createApp(env);
    cached = serverlessExpress({ app }) as Handler;
  }
  return cached(event, context, callback);
};
