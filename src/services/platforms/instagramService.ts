/**
 * Instagram Platform Service
 * Handles video uploads to Instagram Reels
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
  try {
    // Verify file exists
    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        error: `Video file not found: ${videoPath}`,
      };
    }

    const fileSize = fs.statSync(videoPath).size;
    console.log(
      `Preparing to upload: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`
    );

    // Use absolute path for video
    const absoluteVideoPath = path.resolve(videoPath);

    // Create Python script to upload using instagrapi
    const pythonScript = `
import sys
from instagrapi import Client
import json

try:
    # Initialize client
    client = Client()
    
    # Login
    print("🔐 Logging in to Instagram...")
    client.login("${credentials.username}", "${credentials.password}")
    
    # Upload video to Reels
    print("📤 Uploading to Instagram Reels...")
    media = client.clip_upload(
        "${absoluteVideoPath}",
        caption=${JSON.stringify(options.caption)}
    )
    
    print(f"✅ Video uploaded successfully!")
    print(f"📹 Media ID: {media.pk}")
    print(f"🔗 URL: https://www.instagram.com/reel/{media.code}/")
    
except Exception as e:
    print(f"❌ Error uploading to Instagram: {str(e)}")
    sys.exit(1)
`;

    // Save script to temp file
    const scriptPath = path.join(path.dirname(videoPath), "upload_instagram.py");
    fs.writeFileSync(scriptPath, pythonScript);

    console.log("Running Instagram upload script...");

    // Use Python from venv
    let pythonCmd = "/Users/dsahani/Documents/mcq-shorts-agent/.venv/bin/python";
    
    // Fallback to system python if venv not found
    if (!fs.existsSync(pythonCmd)) {
      pythonCmd = process.env.PYTHON_EXECUTABLE || "python3";
    }

    try {
      const { stdout, stderr } = await execAsync(`${pythonCmd} "${scriptPath}"`, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Log all output for debugging
      if (stdout) console.log("Python stdout:", stdout);
      if (stderr) console.log("Python stderr:", stderr);

      console.log(stdout);
      fs.unlinkSync(scriptPath);

      // Extract media ID from output
      const idMatch = stdout.match(/Media ID: (\d+)/);
      const urlMatch = stdout.match(/URL: (.+)/);

      return {
        success: true,
        mediaId: idMatch ? idMatch[1] : undefined,
        url: urlMatch ? urlMatch[1] : undefined,
      };
    } catch (execError: any) {
      // Capture full error details
      const errorOutput = execError.stderr || execError.stdout || execError.message;
      console.error("Python execution error:", errorOutput);
      
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      return {
        success: false,
        error: errorOutput,
      };
    }
  } catch (error: any) {
    const errorMessage = error.stderr || error.message || String(error);
    console.error("❌ Error uploading to Instagram:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
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
  if (!credentials.username || !credentials.password) {
    return {
      success: false,
      error: "Instagram credentials not found. Please set IG_USERNAME and IG_PASSWORD in environment variables",
    };
  }

  const videoPath = findLatestVideo(outputDir);
  if (!videoPath) {
    return {
      success: false,
      error: "No video file found to upload",
    };
  }

  const caption = `🎯 ${topic} Quiz Challenge!

Test your knowledge and see if you can answer all questions correctly! ✅

⏱️ How many did you get right?
💬 Comment your score below!
❤️ Like and follow for more quizzes

#quiz #trivia #${topic.toLowerCase().replace(/\s+/g, "")} #reels #educational #learning #challenge`;

  return uploadToInstagram(videoPath, { caption }, credentials);
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
