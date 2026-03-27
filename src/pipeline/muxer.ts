/**
 * Audio-video muxing pipeline (Phase 4)
 * Muxes audio and video with audio as master clock
 */

import { RenderConfig } from '../types/index.js';
import { muxAudioVideo, extractDuration } from '../utils/ffmpeg.js';
import path from 'path';

/**
 * Mux audio and video for a segment
 * Audio is MASTER - video is trimmed if longer
 */
export async function muxSegment(
  segmentId: string,
  videoFile: string,
  audioFile: string,
  config: RenderConfig
): Promise<{
  muxedFile: string;
  finalDuration: number;
}> {
  const tempDir = path.join(config.tempDir, segmentId);
  const muxedFile = path.join(tempDir, 'muxed.mp4');
  
  // Mux audio and video (audio is master via -shortest flag)
  await muxAudioVideo(videoFile, audioFile, muxedFile);
  
  // Extract final duration to verify sync
  const finalDuration = await extractDuration(muxedFile);
  
  // Verify duration matches audio (within tolerance)
  const audioDuration = await extractDuration(audioFile);
  const tolerance = 0.1; // 100ms tolerance
  
  if (Math.abs(finalDuration - audioDuration) > tolerance) {
    console.warn(
      `⚠️  Duration mismatch for segment ${segmentId}: ` +
      `audio=${audioDuration.toFixed(2)}s, final=${finalDuration.toFixed(2)}s`
    );
  }
  
  return {
    muxedFile,
    finalDuration,
  };
}
