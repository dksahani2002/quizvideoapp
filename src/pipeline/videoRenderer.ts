/**
 * Video rendering pipeline (Phase 3)
 * Renders silent video with text overlays, duration derived from audio
 */

import { Quiz, RenderConfig } from '../types/index.js';
import { renderSilentVideo } from '../utils/ffmpeg.js';
import { sanitizeForFFmpeg } from '../utils/textSanitizer.js';
import path from 'path';

/**
 * Render video for a single quiz segment
 * Duration = audioDuration + safetyPadding
 * Uses component durations for perfect sync
 */
export async function renderSegmentVideo(
  segmentId: string,
  quiz: Quiz,
  componentDurations: {
    question: number;
    options: [number, number, number, number];
    countdown: number;
    answer: number;
  },
  config: RenderConfig
): Promise<{
  videoFile: string;
  videoDuration: number;
}> {
  const tempDir = path.join(config.tempDir, segmentId);
  const videoFile = path.join(tempDir, 'video.mp4');
  
  // Calculate timing for each component (cumulative)
  let currentTime = 0;
  const questionStart = currentTime;
  currentTime += componentDurations.question;
  
  const optionStarts: [number, number, number, number] = [0, 0, 0, 0];
  const optionEnds: [number, number, number, number] = [0, 0, 0, 0];
  
  for (let i = 0; i < 4; i++) {
    optionStarts[i] = currentTime;
    optionEnds[i] = currentTime + componentDurations.options[i];
    currentTime = optionEnds[i];
  }
  
  const countdownStart = currentTime;
  const countdownEnd = currentTime + componentDurations.countdown;
  currentTime = countdownEnd;
  
  // Answer reveal phase (after countdown)
  const answerRevealStart = currentTime;
  const answerRevealEnd = currentTime + componentDurations.answer;
  
  // Get the correct answer text
  const correctAnswer = quiz.options[quiz.answerIndex];
  
  // Generate brief explanation for the answer
  const explanation = `The correct answer is: ${correctAnswer}`;
  
  // Prepare text config with sanitized text and exact timing.
  // Options persist from their start until countdown ends (cumulative reveal).
  // Question stays visible through the entire countdown phase.
  const textConfig = {
    question: sanitizeForFFmpeg(quiz.question),
    options: quiz.options.map(opt => sanitizeForFFmpeg(opt)) as [string, string, string, string],
    answerIndex: quiz.answerIndex,
    explanation: sanitizeForFFmpeg(explanation),
    timing: {
      question: { start: questionStart, end: countdownEnd },
      options: optionStarts.map((start) => ({
        start,
        end: countdownEnd,
      })) as [{ start: number; end: number }, { start: number; end: number }, { start: number; end: number }, { start: number; end: number }],
      countdown: { start: countdownStart, end: countdownEnd },
      answerReveal: { start: answerRevealStart, end: answerRevealEnd },
    },
  };
  
  // Update video duration to include answer reveal
  const finalVideoDuration = answerRevealEnd + config.safetyPadding;
  
  // Render silent video with improved animations
  await renderSilentVideo(
    videoFile,
    finalVideoDuration,
    config.width,
    config.height,
    config.fps,
    textConfig,
    {
      fontFile: config.fontFile,
      safeMargin: config.safeMargin,
      theme: config.theme,
      textAlign: config.textAlign,
      layoutDensity: config.layoutDensity,
      headerTitle: config.headerTitle,
    }
  );
  
  return {
    videoFile,
    videoDuration: finalVideoDuration,
  };
}
