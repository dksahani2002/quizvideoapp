/**
 * Video Generation Controller
 * Handles HTTP requests for video generation
 */

import { generateVideo, VideoGenerationRequest } from "../services/videoGenerationService.js";
import { EnvConfig } from "../config/envConfig.js";

export interface VideoGenerationControllerRequest {
  topic: string;
  questionCount?: number;
}

export interface VideoGenerationControllerResponse {
  success: boolean;
  data?: {
    videoPath: string;
    videoId: string;
    duration: number;
    totalSegments: number;
    completedSegments: number;
  };
  error?: string;
}

/**
 * Generate video with MCQs for a topic
 */
export async function generateVideoController(
  request: VideoGenerationControllerRequest,
  envConfig: EnvConfig
): Promise<VideoGenerationControllerResponse> {
  try {
    const videoRequest: VideoGenerationRequest = {
      topic: request.topic,
      questionCount: request.questionCount || 5,
    };

    const result = await generateVideo(
      videoRequest,
      envConfig.OPENAI_URL,
      envConfig.OPENAI_API_KEY,
      envConfig.OUTPUT_DIR,
      envConfig.CACHE_DIR,
      envConfig.TEMP_DIR,
      envConfig.FONT_FILE
    );

    if (result.success) {
      return {
        success: true,
        data: {
          videoPath: result.videoPath!,
          videoId: result.videoPath!.split("/").pop()?.replace(".mp4", "") || "",
          duration: result.duration || 0,
          totalSegments: result.totalSegments || 0,
          completedSegments: result.completedSegments || 0,
        },
      };
    } else {
      return {
        success: false,
        error: result.error || "Unknown error",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Types declared and exported above
