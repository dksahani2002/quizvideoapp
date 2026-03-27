import "dotenv/config";
import { uploadLatestVideoToYouTube } from "./uploadYoutubeAgent.js";
import { uploadLatestVideoToInstagram, getManualInstagramUploadInstructions } from "./uploadInstagramAgent.js";

/**
 * Main upload orchestrator
 * Uploads the latest generated video to YouTube and Instagram
 */
export async function uploadToSocialMedia(options: {
  youtube?: boolean;
  instagram?: boolean;
  manual?: boolean;
} = { youtube: true, instagram: false, manual: true }): Promise<void> {
  console.log("\n🚀 Starting Social Media Upload Process\n");
  console.log("=" .repeat(50));

  try {
    // Upload to YouTube
    if (options.youtube) {
      console.log("\n📹 Uploading to YouTube...");
      console.log("-".repeat(50));
      const youtubeId = await uploadLatestVideoToYouTube();
      if (youtubeId) {
        console.log("✅ YouTube upload completed!");
      } else {
        console.log("⚠️  YouTube upload failed or skipped");
      }
    }

    // Upload to Instagram
    if (options.instagram) {
      console.log("\n📸 Uploading to Instagram...");
      console.log("-".repeat(50));
      const instagramSuccess = await uploadLatestVideoToInstagram();
      if (instagramSuccess) {
        console.log("✅ Instagram upload completed!");
      } else {
        console.log("⚠️  Instagram upload failed");
        if (options.manual) {
          console.log("\n" + getManualInstagramUploadInstructions());
        }
      }
    } else if (options.manual) {
      console.log("\n" + getManualInstagramUploadInstructions());
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Upload process completed!\n");

  } catch (error) {
    console.error("\n❌ Error during upload:", error);
    process.exit(1);
  }
}

/**
 * Run the upload process based on CLI arguments
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  let options = {
    youtube: true,
    instagram: false,
    manual: true
  };

  if (args.length > 0) {
    options.youtube = args.includes("--youtube") || args.includes("--all");
    options.instagram = args.includes("--instagram") || args.includes("--all");
    options.manual = args.includes("--manual") || !args.includes("--no-manual");
  }

  await uploadToSocialMedia(options);
}

// Run if this is the main module (ES modules)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default uploadToSocialMedia;
