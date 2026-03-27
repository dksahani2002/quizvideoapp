import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { loadEnvConfig, assertProductionConfig } from "./config/envConfig.js";
import { initDatabase } from "./db/connection.js";
import { createApp } from "./app.js";
import { retryStuckJobs } from "./utils/jobRunner.js";

async function startServer() {
  const env = loadEnvConfig();
  assertProductionConfig(env);

  await initDatabase();
  await retryStuckJobs();

  const app = createApp(env);

  const port = env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    if (
      env.NODE_ENV === "development" &&
      fs.existsSync(path.resolve("./frontend/dist"))
    ) {
      console.log(
        "[dev] UI is served from ./frontend/dist — after changing frontend/src, run: npm run build --prefix frontend (or use Vite: npm run dev --prefix frontend on port 5173)"
      );
    }
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
