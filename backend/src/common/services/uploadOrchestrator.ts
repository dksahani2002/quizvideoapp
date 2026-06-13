/**
 * Upload Orchestrator Service
 * Coordinates uploading to multiple platforms
 */

import {
  uploadLatestVideoToYouTube,
  YouTubeUploadResult,
} from "./platforms/youtubeService.js";
import {
  InstagramUploadResult,
} from "./platforms/instagramService.js";

export interface UploadOrchestrationRequest {
  youtube?: boolean;
  instagram?: boolean;
}

export interface UploadOrchestrationResult {
  success: boolean;
  youtube?: YouTubeUploadResult;
  instagram?: InstagramUploadResult;
  errors: string[];
}

/**
 * Upload to all specified platforms
 */
export async function uploadToAllPlatforms(
  request: UploadOrchestrationRequest,
  outputDir: string,
  topic: string,
  youtubeCredentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
  },
  _instagramCredentials: Record<string, never>
): Promise<UploadOrchestrationResult> {
  console.log("\n🚀 Starting Social Media Upload Process\n");
  console.log("=".repeat(50));

  const errors: string[] = [];
  const result: UploadOrchestrationResult = {
    success: true,
    errors,
  };

  try {
    // Upload to YouTube
    if (request.youtube) {
      console.log("\n📹 Uploading to YouTube...");
      console.log("-".repeat(50));
      const youtubeResult = await uploadLatestVideoToYouTube(
        outputDir,
        topic,
        youtubeCredentials
      );
      result.youtube = youtubeResult;

      if (youtubeResult.success) {
        console.log("✅ YouTube upload completed!");
      } else {
        console.log("⚠️  YouTube upload failed");
        if (youtubeResult.error) {
          errors.push(`YouTube: ${youtubeResult.error}`);
        }
      }
    }

    // Upload to Instagram
    if (request.instagram) {
      console.log("\n📸 Uploading to Instagram...");
      console.log("-".repeat(50));
      const instagramResult: InstagramUploadResult = {
        success: false,
        error: "Instagram uploads are disabled here. Use Publishing via Meta Graph API instead.",
      };
      result.instagram = instagramResult;
      errors.push(`Instagram: ${instagramResult.error}`);
    }

    console.log("\n" + "=".repeat(50));

    if (errors.length === 0) {
      console.log("✅ Upload process completed successfully!\n");
    } else {
      console.log("⚠️  Upload process completed with errors:\n");
      errors.forEach((err) => console.log(`   - ${err}`));
      console.log();
      result.success = false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Error during upload:", errorMessage);
    errors.push(errorMessage);
    result.success = false;
  }

  return result;
}

/**
 * Upload only to YouTube
 */
export async function uploadToYouTubeOnly(
  outputDir: string,
  topic: string,
  youtubeCredentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
  }
): Promise<YouTubeUploadResult> {
  console.log("\n🚀 Uploading to YouTube...\n");
  return uploadLatestVideoToYouTube(outputDir, topic, youtubeCredentials);
}

/**
 * Upload only to Instagram
 */
export async function uploadToInstagramOnly(
  outputDir: string,
  topic: string,
  _instagramCredentials: Record<string, never>
): Promise<InstagramUploadResult> {
  void outputDir;
  void topic;
  console.log("\n🚀 Uploading to Instagram...\n");
  return {
    success: false,
    error: "Instagram uploads are disabled here. Use Publishing via Meta Graph API instead.",
  };
}

// Types exported via declarations above
