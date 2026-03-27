/**
 * Final concatenation pipeline (Phase 5)
 * Concatenates all segments with format validation
 */

import { RenderConfig } from '../types/index.js';
import {
  concatVideos,
  validateVideoFormat,
  extractDuration,
  speedUpVideo,
  trimFinalVideoToAudioMaster,
  overlayWatermark,
} from '../utils/ffmpeg.js';
import fs from 'fs/promises';

export interface ConcatSegment {
  file: string;
  duration: number;
}

/**
 * Validate all segments have same format (required for concat)
 */
export async function validateSegmentsForConcat(
  segments: ConcatSegment[],
  config: RenderConfig
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  for (const segment of segments) {
    if (!segment.file) {
      errors.push(`Segment missing file path`);
      continue;
    }
    
    // Check file exists
    try {
      await fs.access(segment.file);
    } catch {
      errors.push(`Segment file not found: ${segment.file}`);
      continue;
    }
    
    // Validate format
    const validation = await validateVideoFormat(
      segment.file,
      config.width,
      config.height,
      config.fps
    );
    
    if (!validation.valid) {
      errors.push(`${segment.file}: ${validation.error}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Concatenate all segments into final video
 */
export async function concatSegments(
  segments: ConcatSegment[],
  outputFile: string,
  config: RenderConfig
): Promise<string> {
  // Filter out invalid segments
  const validSegments = segments.filter(s => s.file);
  
  if (validSegments.length === 0) {
    throw new Error('No valid segments to concatenate');
  }
  
  // Validate all segments
  const validation = await validateSegmentsForConcat(validSegments, config);
  if (!validation.valid) {
    throw new Error(`Segment validation failed:\n${validation.errors.join('\n')}`);
  }
  
  // Concatenate (no re-encoding)
  const segmentFiles = validSegments.map(s => s.file);
  await concatVideos(segmentFiles, outputFile, { fps: config.fps });

  // Safety net if any drift remains (e.g. odd segment edge case).
  await trimFinalVideoToAudioMaster(outputFile);

  // Optional watermark (brand)
  if (config.watermark?.imagePath) {
    try {
      await overlayWatermark(outputFile, config.watermark.imagePath, {
        opacity: config.watermark.opacity,
        position: config.watermark.position,
      });
    } catch (e: any) {
      console.warn('Watermark overlay failed:', e?.message || e);
    }
  }

  // Check total duration
  const totalDuration = await extractDuration(outputFile);
  
  // If exceeds max duration, speed up
  if (totalDuration > config.maxTotalDuration && config.speedUpIfExceeds) {
    const speedFactor = Math.min(1.2, totalDuration / config.maxTotalDuration);
    const spedUpFile = outputFile.replace(/\.[^.]+$/, '_spedup.mp4');
    await speedUpVideo(outputFile, spedUpFile, speedFactor);
    await fs.rename(spedUpFile, outputFile);
    console.log(`⚡ Sped up video by ${(speedFactor * 100).toFixed(0)}% to meet duration limit`);
  }
  
  return outputFile;
}
