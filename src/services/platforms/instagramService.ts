/**
 * Instagram Platform Service
 * Handles video uploads to Instagram Reels
 */

import fs from "fs";
import path from "path";
// Password-based automation disabled; keep file for compatibility.

export interface InstagramUploadOptions {
  caption: string;
}

export interface InstagramUploadResult {
  success: boolean;
  mediaId?: string;
  url?: string;
  error?: string;
}

/**
 * NOTE: Password-based Instagram automation is intentionally disabled.
 * Use the official Meta Graph API publishing flow instead.
 */
/**
 * Find the latest video file in the output directory
 */
export function findLatestVideo(outputDir: string = "./output/videos"): string | null {
  try {
    if (!fs.existsSync(outputDir)) {
      console.error(`Output directory not found: ${outputDir}`);
      return null;
    }

    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => ({
        name: f,
        path: path.join(outputDir, f),
        time: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      console.error("No MP4 files found in output directory");
      return null;
    }

    return files[0].path;
  } catch (error) {
    console.error("Error finding latest video:", error);
    return null;
  }
}

/**
 * Upload video to Instagram Reels using Instagrapi
 * Requires: pip install instagrapi
 */
export async function uploadToInstagram(
  videoPath: string,
  options: InstagramUploadOptions,
  credentials: {
    username?: string;
    password?: string;
  }
): Promise<InstagramUploadResult> {
  void videoPath;
  void options;
  void credentials;
  return {
    success: false,
    error: "Password-based Instagram automation is disabled. Use Meta Graph API publishing instead.",
  };
}

/**
 * Upload the latest video to Instagram with auto-generated caption
 */
export async function uploadLatestVideoToInstagram(
  outputDir: string,
  topic: string,
  credentials: {
    username?: string;
    password?: string;
  }
): Promise<InstagramUploadResult> {
  void outputDir;
  void topic;
  void credentials;
  return {
    success: false,
    error: "Password-based Instagram automation is disabled. Use Meta Graph API publishing instead.",
  };
}

/**
 * Get manual upload instructions for Instagram Creator Studio
 */
export function getManualInstagramUploadInstructions(outputDir: string = "./output/videos"): string {
  const videoPath = findLatestVideo(outputDir);
  return `
📱 Manual Instagram Reels Upload Instructions:

1. Go to: https://business.instagram.com/
2. Login with your Instagram business account
3. Navigate to "Creator Studio" → "Content Library"
4. Click "Upload"
5. Select video: ${videoPath || "./output/videos/latest.mp4"}
6. Choose "Reels" as content type
7. Add caption:
   🎯 Quiz Challenge!
   Test your knowledge! ✅
   #quiz #trivia #reels
8. Click "Publish"

Requirements:
- Video must be less than 1 minute (Instagram Shorts/Reels)
- Format: MP4, H.264, AAC
- Dimensions: 9:16 aspect ratio (already optimized)
`;
}

// Types exported via declarations above
