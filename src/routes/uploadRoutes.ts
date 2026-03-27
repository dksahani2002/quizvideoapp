/**
 * Upload Routes
 * REST API endpoints for uploading videos to social media platforms
 */

import { Router, Request, Response } from "express";
import {
  uploadController,
} from "../controllers/uploadController.js";
import { EnvConfig } from "../config/envConfig.js";

function classifyInstagramFailure(errors: string[]): { status: number; hint?: string } {
  const msg = (errors || []).join("\n");
  const m = msg.toLowerCase();

  if (
    m.includes("credentials not found") ||
    m.includes("ig_username") ||
    m.includes("ig_password")
  ) {
    return { status: 400, hint: "Set Instagram username/password in settings or environment variables." };
  }

  if (
    m.includes("blacklist") ||
    m.includes("added to the blacklist") ||
    m.includes("we can send you an email") ||
    m.includes("checkpoint_required") ||
    m.includes("challenge_required") ||
    m.includes("two_factor_required") ||
    m.includes("login_required")
  ) {
    return {
      status: 403,
      hint:
        "Instagram blocked automated login. Try logging in manually from this IP, complete any security checks/2FA, then retry. If it persists, change network/IP or use manual upload.",
    };
  }

  if (m.includes("rate") && m.includes("limit")) {
    return { status: 429, hint: "Rate limited by Instagram. Wait and retry later." };
  }

  return { status: 500 };
}

export function createUploadRoutes(envConfig: EnvConfig): Router {
  const router = Router();

  /**
   * POST /api/uploads/all
   * Upload the latest video to all configured platforms
   *
   * Response:
   * {
   *   "success": true,
   *   "platforms": {
   *     "youtube": {
   *       "success": true,
   *       "videoId": "xyz123",
   *       "url": "https://youtube.com/watch?v=xyz123"
   *     },
   *     "instagram": {
   *       "success": true,
   *       "mediaId": "123456",
   *       "url": "https://instagram.com/reel/abc123/"
   *     }
   *   },
   *   "errors": []
   * }
   */
  router.post("/all", async (req: Request, res: Response) => {
    try {
      const response = await uploadController({ platforms: ["youtube", "instagram"], userId: req.user?.id }, envConfig);

      if (response.success) {
        return res.status(200).json(response);
      } else {
        return res.status(500).json(response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
      });
    }
  });

  /**
   * POST /api/uploads/youtube
   * Upload the latest video to YouTube only
   *
   * Response:
   * {
   *   "success": true,
   *   "platforms": {
   *     "youtube": {
   *       "success": true,
   *       "videoId": "xyz123",
   *       "url": "https://youtube.com/watch?v=xyz123"
   *     }
   *   },
   *   "errors": []
   * }
   */
  router.post("/youtube", async (req: Request, res: Response) => {
    try {
      const response = await uploadController({ platforms: ["youtube"], userId: req.user?.id }, envConfig);

      if (response.success) {
        return res.status(200).json(response);
      } else {
        return res.status(500).json(response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
      });
    }
  });

  /**
   * POST /api/uploads/instagram
   * Upload the latest video to Instagram only
   *
   * Response:
   * {
   *   "success": true,
   *   "platforms": {
   *     "instagram": {
   *       "success": true,
   *       "mediaId": "123456",
   *       "url": "https://instagram.com/reel/abc123/"
   *     }
   *   },
   *   "errors": []
   * }
   */
  router.post("/instagram", async (req: Request, res: Response) => {
    try {
      const response = await uploadController({ platforms: ["instagram"], userId: req.user?.id }, envConfig);

      if (response.success) {
        return res.status(200).json(response);
      } else {
        const { status, hint } = classifyInstagramFailure(response.errors || []);
        return res.status(status).json({ ...response, hint });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        hint:
          "Unexpected server error while uploading to Instagram. Check server logs for the Python output and try again.",
      });
    }
  });

  return router;
}

// createUploadRoutes exported above
