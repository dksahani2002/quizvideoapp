/**
 * Upload Routes
 * REST API endpoints for uploading videos to social media platforms
 */

import { Router, Request, Response } from "express";
import {
  uploadController,
} from "../controllers/uploadController.js";
import { EnvConfig } from "../config/envConfig.js";

function classifyYouTubeFailure(errors: string[], youtubeErr?: string): { status: number; hint?: string } {
  const msg = [...(errors || []), youtubeErr || ""].join("\n").toLowerCase();

  if (
    msg.includes("not configured") ||
    msg.includes("add credentials") ||
    msg.includes("connect youtube")
  ) {
    return {
      status: 400,
      hint: "Open Settings → YouTube API credentials, then Publishing → connect YouTube.",
    };
  }

  if (msg.includes("no video file found") || msg.includes("video file not found")) {
    return { status: 404, hint: "Generate a completed video first, or check that the file exists on the server." };
  }

  if (
    msg.includes("invalid_grant") ||
    msg.includes("invalid credentials") ||
    msg.includes("token has been expired") ||
    msg.includes("token has been revoked")
  ) {
    return {
      status: 401,
      hint: "Reconnect YouTube in Publishing (OAuth refresh token may be invalid).",
    };
  }

  if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("exceeded")) {
    return { status: 429, hint: "YouTube API quota or rate limit — try again later." };
  }

  if (msg.includes("access denied") || msg.includes("forbidden") || msg.includes("insufficient")) {
    return { status: 403 };
  }

  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("network")) {
    return { status: 503, hint: "Network error talking to Google. Check connectivity and DNS." };
  }

  return { status: 502, hint: "YouTube API rejected the upload. See the error message and server logs." };
}

function classifyInstagramFailure(errors: string[]): { status: number; hint?: string } {
  const msg = (errors || []).join("\n");
  const m = msg.toLowerCase();

  if (m.includes("instagram upload is not supported")) {
    return { status: 400, hint: "Use Publishing to connect Instagram (Meta Graph API) and publish." };
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
      }
      const ytErr = response.platforms?.youtube?.error;
      const { status, hint } = classifyYouTubeFailure(response.errors || [], ytErr);
      const error =
        (response.errors && response.errors[0]) || ytErr || "Upload failed";
      return res.status(status).json({ ...response, error, hint });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { status, hint } = classifyYouTubeFailure([errorMessage]);
      return res.status(status).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        error: errorMessage,
        hint,
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
      }
      const ytErr = response.platforms?.youtube?.error;
      const { status, hint } = classifyYouTubeFailure(response.errors || [], ytErr);
      const error =
        (response.errors && response.errors[0]) ||
        ytErr ||
        "YouTube upload failed";
      return res.status(status).json({ ...response, error, hint });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { status, hint } = classifyYouTubeFailure([errorMessage]);
      return res.status(status).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        error: errorMessage,
        hint,
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

// Backward-compatible alias while normalizing route factory naming.
export const createUploadsRoutes = createUploadRoutes;
