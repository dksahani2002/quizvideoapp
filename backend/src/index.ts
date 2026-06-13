import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { BACKEND_ROOT, REPO_ROOT, frontendDistPath } from "./common/config/paths.js";
import { loadEnvConfig, assertProductionConfig } from "./common/config/envConfig.js";
import { initDatabase } from "./common/db/connection.js";
import { createApp } from "./app.js";
import { retryStuckJobs } from "./mcq/videoJob/jobRunner.js";

loadDotenv({ path: path.join(REPO_ROOT, ".env") });
loadDotenv({ path: path.join(BACKEND_ROOT, ".env") });

async function startServer() {
  const env = loadEnvConfig();
  assertProductionConfig(env);

  await initDatabase();
  await retryStuckJobs();

  const app = createApp(env);

  const port = env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    if (env.NODE_ENV === "development" && fs.existsSync(frontendDistPath())) {
      console.log(
        "[dev] UI is served from frontend/dist — run: npm run build (or live UI: npm run ui on port 5173)"
      );
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use (another dev server may still be running).\n` +
          `  Stop it:  lsof -ti :${port} | xargs kill\n` +
          `  Or use another port:  PORT=3001 npm run dev`
      );
    } else {
      console.error("HTTP server error:", err);
    }
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, closing server…`);
    server.close(() => {
      mongoose.connection
        .close(false)
        .then(() => {
          console.log("MongoDB connection closed");
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
