import type { Handler } from "aws-lambda";
import serverlessExpress from "@codegenie/serverless-express";

import "dotenv/config";
import { loadEnvConfig, assertProductionConfig } from "../config/envConfig.js";
import { initDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { retryStuckJobs } from "../utils/jobRunner.js";

let cached: Handler | undefined;

export const handler: Handler = async (event, context, callback) => {
  if (!cached) {
    process.env.NODE_ENV = process.env.NODE_ENV || "production";
    const env = loadEnvConfig();
    assertProductionConfig(env);
    await initDatabase();
    if (process.env.SKIP_STUCK_RETRY_ON_COLD_START !== "1") {
      await retryStuckJobs();
    }
    const app = createApp(env);
    cached = serverlessExpress({ app }) as Handler;
  }
  return cached(event, context, callback);
};
