/**
 * Video Generation Service
 * Orchestrates MCQ generation and video rendering
 */

import { Quiz } from "../types/index.js";
import { generateMCQs, MCQ } from "./mcqService.js";
import { loadMCQsFromFile } from "../agents/mcqAgent.js";
import fs from "fs";
import path from "path";
import { renderQuizVideo } from "../pipeline/orchestrator.js";
import { createTTSService } from "./ttsService.js";
import { getDefaultConfig } from "./videoConfig.js";

export interface VideoGenerationRequest {
  topic: string;
  questionCount?: number;
  mcqFile?: string; // path to a local JSON file (manual mode)
}

export interface VideoGenerationResponse {
  success: boolean;
  videoPath?: string;
  videoId?: string;
  duration?: number;
  totalSegments?: number;
  completedSegments?: number;
  error?: string;
}

/**
 * Generate a complete video with MCQs for a given topic
 */
export async function generateVideo(
  request: VideoGenerationRequest,
  openaiUrl: string,
  openaiApiKey: string,
  outputDir: string,
  cacheDir: string,
  tempDir: string,
  fontFile?: string
): Promise<VideoGenerationResponse> {
  try {
    const { topic, questionCount = 5, mcqFile } = request;

    console.log(`\n🚀 Starting Video Generation for Topic: "${topic}"\n`);

    // Step 1: Get MCQs — file, mock, or OpenAI
    let mcqs: MCQ[];

    if (mcqFile || process.env.MCQ_SOURCE === "file") {
      const filePath = mcqFile || process.env.MCQ_FILE || "";
      if (!filePath) {
        throw new Error("MCQ_SOURCE=file requires mcqFile or MCQ_FILE env var");
      }
      console.log(`📂 Step 1: Loading MCQs from file: ${filePath}`);
      mcqs = loadMCQsFromFile(filePath) as MCQ[];
    } else if (process.env.MOCK_MCQS === "true") {
      console.log("🧪 Step 1: Using mock MCQs...");
      mcqs = Array.from({ length: questionCount }).map((_, i) => ({
        question: `Sample question ${i + 1} about ${topic}`,
        options: [
          `Correct answer for ${i + 1}`,
          `Distractor A for ${i + 1}`,
          `Distractor B for ${i + 1}`,
          `Distractor C for ${i + 1}`,
        ],
        answerIndex: 0,
      }));
      console.log(`✅ (mock) Generated ${mcqs.length} MCQs\n`);
    } else {
      console.log("🤖 Step 1: Generating MCQs via OpenAI...");
      mcqs = await generateMCQs(topic, openaiUrl, openaiApiKey, questionCount);
      console.log(`✅ Generated ${mcqs.length} MCQs\n`);
    }

    // Step 2: Convert to Quiz format
    console.log("🔄 Step 2: Validating and converting MCQs...");
    const quizzes: Quiz[] = mcqs
      .map((mcq: MCQ): Quiz | null => {
        const options = Array.isArray(mcq.options)
          ? mcq.options
          : Object.values(mcq.options || {});

        if (options.length !== 4) {
          console.warn(
            `⚠️  Skipping quiz with ${options.length} options: ${mcq.question.substring(0, 50)}...`
          );
          return null;
        }

        return {
          question: mcq.question,
          options: options as [string, string, string, string],
          answerIndex: mcq.answerIndex as 0 | 1 | 2 | 3,
          language: "en",
        };
      })
      .filter((q): q is Quiz => q !== null);

    if (quizzes.length === 0) {
      return {
        success: false,
        error: "No valid quizzes generated",
      };
    }

    console.log(`✅ Validated ${quizzes.length} quizzes\n`);

    // Step 3: Render video
    console.log("🎬 Step 3: Rendering video...\n");

    // Smoke-test / CI mode: allow skipping heavy rendering
    const skipRender = process.env.SKIP_RENDER === "true";

    const config = getDefaultConfig();
    config.outputDir = outputDir;
    config.cacheDir = cacheDir;
    config.tempDir = tempDir;
    if (fontFile) {
      config.fontFile = fontFile;
    }

    const ttsService = createTTSService(config.ttsProvider, {
      apiKey: openaiApiKey,
      model: config.ttsModel,
      cacheDir: config.cacheDir,
    });

    if (skipRender) {
      // Create a placeholder file to simulate generated video
      const timestamp = Date.now();
      const fakeFile = path.join(config.outputDir, `quiz_video_${timestamp}.mp4`);
      try {
        fs.mkdirSync(config.outputDir, { recursive: true });
        fs.writeFileSync(fakeFile, "");
      } catch (err) {
        // ignore
      }

      return {
        success: true,
        videoPath: fakeFile,
        duration: 0,
        totalSegments: quizzes.length,
        completedSegments: quizzes.length,
      };
    }

    const result = await renderQuizVideo(quizzes, ttsService, config);

    if (result.success) {
      const completedSegments = result.segments.filter(
        (s) => s.status === "muxed"
      ).length;

      console.log(`\n✅ Video generated successfully!`);
      console.log(`   Path: ${result.outputFile}`);
      console.log(`   Duration: ${result.totalDuration?.toFixed(2)}s`);
      console.log(`   Segments: ${completedSegments}/${result.segments.length}`);

      return {
        success: true,
        videoPath: result.outputFile,
        duration: result.totalDuration,
        totalSegments: result.segments.length,
        completedSegments: completedSegments,
      };
    } else {
      console.error('Video rendering result (failure):', JSON.stringify(result, null, 2));
      return {
        success: false,
        error: `Video rendering failed: ${result.errors.join(", ")}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Video generation failed: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Types exported via declarations above
