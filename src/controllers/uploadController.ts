/**
 * Upload Controller
 * Handles HTTP requests for uploading to social media platforms
 */

import {
  uploadToAllPlatforms,
  uploadToYouTubeOnly,
  uploadToInstagramOnly,
  UploadOrchestrationResult,
} from "../services/uploadOrchestrator.js";
import { EnvConfig } from "../config/envConfig.js";
import path from "path";
import fs from "fs";
import { Video } from "../db/models/Video.js";
import { loadSettings } from "../services/settingsService.js";
import { downloadObjectToFile } from "../services/s3Storage.js";

export interface UploadControllerRequest {
  platforms?: ("youtube" | "instagram")[];
  userId?: string;
}

export interface PlatformUploadResponse {
  youtube?: {
    success: boolean;
    videoId?: string;
    url?: string;
    error?: string;
  };
  instagram?: {
    success: boolean;
    mediaId?: string;
    url?: string;
    error?: string;
  };
}

export interface UploadControllerResponse {
  success: boolean;
  platforms: PlatformUploadResponse;
  errors: string[];
}

/**
 * Upload to specified platforms
 */
export async function uploadController(
  request: UploadControllerRequest,
  envConfig: EnvConfig
): Promise<UploadControllerResponse> {
  try {
    const platforms = request.platforms || ["youtube", "instagram"];
    const topic = envConfig.TOPIC || "Quiz";
    const userId = request.userId;

    // Prefer per-user settings (multi-tenant). Fall back to env credentials for single-user/dev.
    const userSettings = userId ? await loadSettings(userId) : null;

    const youtubeCredentials = {
      clientId: userSettings?.youtube.clientId || envConfig.YT_CLIENT_ID,
      clientSecret: userSettings?.youtube.clientSecret || envConfig.YT_CLIENT_SECRET,
      redirectUri: userSettings?.youtube.redirectUri || envConfig.YT_REDIRECT_URI,
      refreshToken: userSettings?.youtube.refreshToken || envConfig.YT_REFRESH_TOKEN,
    };

    const instagramCredentials = {
      username: userSettings?.instagram.username || envConfig.IG_USERNAME,
      password: userSettings?.instagram.password || envConfig.IG_PASSWORD,
    };

    // Resolve the directory containing the latest MP4 for upload.
    // On AWS, videos are stored in S3 and referenced by Video.s3Bucket/s3Key.
    let resolvedOutputDir = envConfig.OUTPUT_DIR;
    if (userId) {
      const latest = await Video.findOne({ userId, status: "completed" }).sort({ createdAt: -1 }).lean();
      if (latest?.s3Bucket && latest?.s3Key) {
        const tmpDir = path.join(envConfig.TEMP_DIR || "/tmp", "uploads", userId);
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const outPath = path.join(tmpDir, latest.filename || "latest.mp4");
        await downloadObjectToFile(latest.s3Bucket, latest.s3Key, outPath);
        resolvedOutputDir = tmpDir;
      } else {
        // Local disk mode (dev)
        resolvedOutputDir = path.join(envConfig.OUTPUT_DIR, userId);
      }
    }

    let result: UploadOrchestrationResult;

    if (platforms.length === 1) {
      if (platforms[0] === "youtube") {
        const youtubeResult = await uploadToYouTubeOnly(
          resolvedOutputDir,
          topic,
          youtubeCredentials
        );
        result = {
          success: youtubeResult.success,
          youtube: youtubeResult,
          errors: youtubeResult.error ? [youtubeResult.error] : [],
        };
      } else {
        const instagramResult = await uploadToInstagramOnly(
          resolvedOutputDir,
          topic,
          instagramCredentials
        );
        result = {
          success: instagramResult.success,
          instagram: instagramResult,
          errors: instagramResult.error ? [instagramResult.error] : [],
        };
      }
    } else {
      result = await uploadToAllPlatforms(
        {
          youtube: platforms.includes("youtube"),
          instagram: platforms.includes("instagram"),
        },
        resolvedOutputDir,
        topic,
        youtubeCredentials,
        instagramCredentials
      );
    }

    const platformResponse: PlatformUploadResponse = {};

    if (result.youtube) {
      platformResponse.youtube = {
        success: result.youtube.success,
        videoId: result.youtube.videoId,
        url: result.youtube.url,
        error: result.youtube.error,
      };
    }

    if (result.instagram) {
      platformResponse.instagram = {
        success: result.instagram.success,
        mediaId: result.instagram.mediaId,
        url: result.instagram.url,
        error: result.instagram.error,
      };
    }

    return {
      success: result.success,
      platforms: platformResponse,
      errors: result.errors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      platforms: {},
      errors: [errorMessage],
    };
  }
}

/**
 * Upload to YouTube only
 */
export async function uploadToYoutubeController(
  envConfig: EnvConfig
): Promise<UploadControllerResponse> {
  return uploadController({ platforms: ["youtube"] }, envConfig);
}

/**
 * Upload to Instagram only
 */
export async function uploadToInstagramController(
  envConfig: EnvConfig
): Promise<UploadControllerResponse> {
  return uploadController({ platforms: ["instagram"] }, envConfig);
}

/**
 * Upload to all platforms
 */
export async function uploadToAllController(
  envConfig: EnvConfig
): Promise<UploadControllerResponse> {
  return uploadController({ platforms: ["youtube", "instagram"] }, envConfig);
}

// Types exported via declarations above
