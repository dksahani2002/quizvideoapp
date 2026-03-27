import fs from "fs";
import path from "path";
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  process.env.YT_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.YT_REFRESH_TOKEN
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client
});

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
 * Upload video to YouTube
 */
export async function uploadToYouTube(
  videoPath: string,
  title: string,
  description: string,
  tags: string[] = ["quiz", "shorts", "educational"]
): Promise<string | null> {
  try {
    // Verify file exists
    if (!fs.existsSync(videoPath)) {
      console.error(`Video file not found: ${videoPath}`);
      return null;
    }

    const fileSize = fs.statSync(videoPath).size;
    console.log(`Uploading video: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const res = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: title.slice(0, 100),
            description: description.slice(0, 5000),
            tags: tags.slice(0, 30), // YouTube allows max 30 tags
            categoryId: "22" // People & Blogs category
          },
          status: {
            privacyStatus: "public",
            madeForKids: false
          }
        },
        media: {
          body: fs.createReadStream(videoPath)
        }
      },
      {
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesProcessed / fileSize) * 100);
          process.stdout.write(`\rUpload progress: ${progress}%`);
        }
      }
    );

    console.log("\n✅ Video uploaded successfully!");
    console.log(`📹 Video ID: ${res.data.id}`);
    console.log(`🔗 URL: https://youtube.com/watch?v=${res.data.id}`);

    return res.data.id || null;
  } catch (error: any) {
    console.error("❌ Error uploading to YouTube:", error.message);
    return null;
  }
}

/**
 * Upload the latest generated video to YouTube
 */
export async function uploadLatestVideoToYouTube(): Promise<string | null> {
  try {
    const videoPath = findLatestVideo();
    if (!videoPath) {
      console.error("No video file found to upload");
      return null;
    }

    const topic = process.env.TOPIC || "Quiz";
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

#quiz #trivia #${topic.toLowerCase().replace(/\s+/g, '')} #shorts #educational`;

    const tags = [
      "quiz",
      "shorts",
      "educational",
      topic.toLowerCase().replace(/\s+/g, ''),
      "trivia",
      "learning"
    ];

    return await uploadToYouTube(videoPath, title, description, tags);
  } catch (error) {
    console.error("Error in uploadLatestVideoToYouTube:", error);
    return null;
  }
}
