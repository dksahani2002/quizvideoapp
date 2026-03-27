/**
 * Video Configuration Service
 * Provides default configuration for video rendering
 */

import os from "os";

/**
 * Get default video configuration
 */
export function getDefaultConfig(): any {
  const platform = os.platform();
  
  let fontFile = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"; // Linux
  
  if (platform === "darwin") {
    fontFile = "/System/Library/Fonts/Helvetica.ttc"; // macOS
  } else if (platform === "win32") {
    fontFile = "C:\\Windows\\Fonts\\arial.ttf"; // Windows
  }

  return {
    // Video specs
    width: 1080,
    height: 1920,
    fps: 30,
    // bitrate may be used by ffmpeg but is not part of RenderConfig interface
    bitrate: "8000k",
    
    // Audio specs
    sampleRate: 44100,
    channels: 2,
    
    // Font and styling
    fontFile,
    fontSize: {
      question: 48,
      options: 40,
      countdown: 60,
      answer: 44,
    },
    colors: {
      background: "#000000",
      questionText: "#FFFFFF",
      optionText: "#FFFFFF",
      optionBg: "#1a1a1a",
      optionBgSelected: "#4A90E2",
      optionBgCorrect: "#27AE60",
      optionBgWrong: "#E74C3C",
      countdownText: "#FFD700",
      answerText: "#27AE60",
    },
    
    // Timing / durations
    questionDuration: 5,
    optionDuration: 2.5,
    countdownDuration: 3,
    answerDuration: 3,
    safetyPadding: 0.2,
    minSegmentDuration: 1.2,
    maxAnimationTime: 10,

    // Directories
    outputDir: "./output/videos",
    cacheDir: "./cache",
    tempDir: "./temp",

    // TTS
    ttsProvider: "openai",
    ttsVoice: undefined,
    ttsModel: "tts-1",

    // Concurrency
    maxConcurrentSegments: 3,

    // Text rendering / layout
    maxLineLength: 50,
    safeMargin: { top: 40, bottom: 40, left: 40, right: 40 },

    // Intro/outro
    introVideo: undefined,
    outroVideo: undefined,

    // Post-processing
    maxTotalDuration: 60,
    speedUpIfExceeds: true,
  };

}
