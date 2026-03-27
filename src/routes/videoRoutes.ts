/**
 * Video Routes
 * REST API endpoints for video generation
 */

import { Router, Request, Response } from "express";
import { generateVideoController, VideoGenerationControllerRequest } from "../controllers/videoController.js";
import { EnvConfig } from "../config/envConfig.js";

export function createVideoRoutes(envConfig: EnvConfig): Router {
  const router = Router();

  /**
   * POST /api/videos/generate
   * Generate a video with quiz questions for a given topic
   *
   * Request body:
   * {
   *   "topic": "JavaScript Event Loop",
   *   "questionCount": 5
   * }
   *
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "videoPath": "/path/to/video.mp4",
   *     "videoId": "timestamp",
   *     "duration": 45.5,
   *     "totalSegments": 5,
   *     "completedSegments": 5
   *   }
   * }
   */
  router.post("/generate", async (req: Request, res: Response) => {
    try {
      const request = req.body as VideoGenerationControllerRequest;

      if (!request.topic) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: topic",
        });
      }

      const response = await generateVideoController(request, envConfig);

      if (response.success) {
        return res.status(200).json(response);
      } else {
        return res.status(500).json(response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  return router;
}

// createVideoRoutes exported above
