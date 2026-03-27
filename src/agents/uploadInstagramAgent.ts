import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Find the latest video file in the output directory
 */
export function findLatestVideo(outputDir: string = "./output/videos"): string | null {
  try {
    if (!fs.existsSync(outputDir)) {
      console.error(`Output directory not found: ${outputDir}`);
      return null;
    }

    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({
        name: f,
        path: path.join(outputDir, f),
        time: fs.statSync(path.join(outputDir, f)).mtime.getTime()
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
 * Check if Instagram CLI tool is installed
 */
export async function checkInstagramTools(): Promise<boolean> {
  try {
    // Check for Instagrapi or Instagram CLI
    await execAsync("which instagrapi");
    return true;
  } catch {
    console.warn("⚠️  Instagram CLI tools not found. Install using:");
    console.warn("  npm install instagrapi-scraper");
    console.warn("Or use Instagram's official Creator Studio at https://business.instagram.com");
    return false;
  }
}

/**
 * Upload video to Instagram Reels using Instagrapi Python package
 * Requires: pip install instagrapi
 */
export async function uploadToInstagram(
  videoPath: string,
  caption: string,
  instagramUsername: string,
  instagramPassword: string
): Promise<boolean> {
  try {
    // Verify file exists
    if (!fs.existsSync(videoPath)) {
      console.error(`Video file not found: ${videoPath}`);
      return false;
    }

    const fileSize = fs.statSync(videoPath).size;
    console.log(`Preparing to upload: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

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
    client.login("${instagramUsername}", "${instagramPassword}")
    
    # Upload video to Reels
    print("📤 Uploading to Instagram Reels...")
    media = client.clip_upload(
        "${videoPath}",
        caption=${JSON.stringify(caption)}
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
    
    // Use the virtual environment's python executable if available
    const pythonCmd = process.env.PYTHON_EXECUTABLE || '/Users/dsahani/Documents/mcq-shorts-agent/.venv/bin/python' || 'python3';
    try {
      const { stdout, stderr } = await execAsync(`${pythonCmd} "${scriptPath}"`);
      
      if (stderr && stderr.includes('Error')) {
        console.error("Instagram upload error:", stderr);
        console.log("Script saved at:", scriptPath);
        return false;
      }

      console.log(stdout);
      fs.unlinkSync(scriptPath);
      return true;
    } catch (execError: any) {
      console.error("Script execution error:", execError.stderr || execError.message);
      console.log("Debug: Script path:", scriptPath);
      if (fs.existsSync(scriptPath)) {
        console.log("Script content:\n", fs.readFileSync(scriptPath, 'utf8'));
      }
      return false;
    }

  } catch (error: any) {
    console.error("❌ Error uploading to Instagram:", error.message);
    return false;
  }
}

/**
 * Upload the latest generated video to Instagram
 * Note: Requires Instagram username and password in .env
 */
export async function uploadLatestVideoToInstagram(): Promise<boolean> {
  try {
    const videoPath = findLatestVideo();
    if (!videoPath) {
      console.error("No video file found to upload");
      return false;
    }

    const igUsername = process.env.IG_USERNAME;
    const igPassword = process.env.IG_PASSWORD;

    if (!igUsername || !igPassword) {
      console.error("Instagram credentials not found. Please set IG_USERNAME and IG_PASSWORD in .env");
      console.log("\n📋 Alternative: Use Instagram Creator Studio:");
      console.log("   1. Go to https://business.instagram.com/");
      console.log("   2. Login with your Instagram account");
      console.log("   3. Upload video from: " + videoPath);
      return false;
    }

    const topic = process.env.TOPIC || "Quiz";
    const caption = `🎯 ${topic} Quiz Challenge!

Test your knowledge and see if you can answer all questions correctly! ✅

⏱️ How many did you get right?
💬 Comment your score below!
❤️ Like and follow for more quizzes

#quiz #trivia #${topic.toLowerCase().replace(/\s+/g, '')} #reels #educational #learning #challenge`;

    return await uploadToInstagram(videoPath, caption, igUsername, igPassword);
  } catch (error) {
    console.error("Error in uploadLatestVideoToInstagram:", error);
    return false;
  }
}

/**
 * Manual upload via Creator Studio (recommended)
 */
export function getManualInstagramUploadInstructions(): string {
  const videoPath = findLatestVideo();
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
