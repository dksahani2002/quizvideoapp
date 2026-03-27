/**
 * YouTube Platform Service
 * Handles video uploads to YouTube
 */

import fs from "fs";
import path from "path";
import { google } from "googleapis";

export interface YouTubeUploadOptions {
  title: string;
  description: string;
  tags?: string[];
  privacyStatus?: "public" | "unlisted" | "private";
  categoryId?: string;
  madeForKids?: boolean;
}

export interface YouTubeUploadResult {
  success: boolean;
  videoId?: string;
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
 * Create YouTube client with OAuth2 credentials
 */
function createYouTubeClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  refreshToken: string
) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.youtube({
    version: "v3",
    auth: oauth2Client,
  });
}

/**
 * Upload video to YouTube
 */
export async function uploadToYouTube(
  videoPath: string,
  options: YouTubeUploadOptions,
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
  }
): Promise<YouTubeUploadResult> {
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
      `Uploading video: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`
    );

    const youtube = createYouTubeClient(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri,
      credentials.refreshToken
    );

    const res = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: options.title.slice(0, 100),
            description: options.description.slice(0, 5000),
            tags: (options.tags || []).slice(0, 30),
            categoryId: options.categoryId || "22", // People & Blogs
          },
          status: {
            privacyStatus: options.privacyStatus || "public",
            madeForKids: options.madeForKids ?? false,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      },
      {
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesProcessed / fileSize) * 100);
          process.stdout.write(`\rUpload progress: ${progress}%`);
        },
      }
    );

    console.log("\n✅ Video uploaded successfully!");
    console.log(`📹 Video ID: ${res.data.id}`);
    console.log(`🔗 URL: https://youtube.com/watch?v=${res.data.id}`);

    return {
      success: true,
      videoId: res.data.id || undefined,
      url: res.data.id ? `https://youtube.com/watch?v=${res.data.id}` : undefined,
    };
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    console.error("❌ Error uploading to YouTube:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Upload the latest video to YouTube with auto-generated metadata
 */
export async function uploadLatestVideoToYouTube(
  outputDir: string,
  topic: string,
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
  }
): Promise<YouTubeUploadResult> {
  const videoPath = findLatestVideo(outputDir);
  if (!videoPath) {
    return {
      success: false,
      error: "No video file found to upload",
    };
  }

  const title = `${topic} - Quick Quiz Challenge 🎯`;
  const description = `Test your knowledge about ${topic}! 

⏱️ How long will it take you to answer?
✅ Answer reveals are included
🎓 Learn while you play

Topics covered in this quiz:
- ${topic} fundamentals
- Key concepts
- Real-world applications

Don't forget to like, subscribe, and share!

#quiz #trivia #${topic.toLowerCase().replace(/\s+/g, "")} #shorts #educational`;

  const tags = [
    "quiz",
    "shorts",
    "educational",
    topic.toLowerCase().replace(/\s+/g, ""),
    "trivia",
    "learning",
  ];

  return uploadToYouTube(videoPath, { title, description, tags }, credentials);
}

// Types exported via declarations above
