/**
 * Main pipeline orchestrator
 * Coordinates all phases with error handling and parallel processing
 */

import { Quiz, SegmentMetadata, RenderConfig } from '../types/index.js';
import { validateQuiz, normalizeQuiz } from '../utils/textSanitizer.js';
import { generateSegmentAudio } from './audioGenerator.js';
import { renderSegmentVideo } from './videoRenderer.js';
import { muxSegment } from './muxer.js';
import { concatSegments as concatVideoSegments, ConcatSegment } from './concatPipeline.js';
import { TTSService } from '../services/ttsService.js';
import { buildCues, writeSrtAndVtt } from './captions.js';
import path from 'path';
import fs from 'fs/promises';

export interface PipelineResult {
  success: boolean;
  outputFile?: string;
  segments: SegmentMetadata[];
  errors: string[];
  totalDuration?: number;
}

/**
 * Process a single quiz segment through all phases
 */
async function processSegment(
  segmentId: string,
  quiz: Quiz,
  ttsService: TTSService,
  config: RenderConfig
): Promise<SegmentMetadata> {
  const metadata: SegmentMetadata = {
    segmentId,
    quiz,
    audioFiles: {
      question: '',
      options: ['', '', '', ''],
      countdown: '',
      answer: '',
    },
    audioConcatFile: '',
    audioDuration: 0,
    videoFile: '',
    videoDuration: 0,
    muxedFile: '',
    finalDuration: 0,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  try {
    // PHASE 2: Audio generation
    metadata.status = 'audio';
    metadata.updatedAt = Date.now();
    const audioResult = await generateSegmentAudio(segmentId, quiz, ttsService, config);
    metadata.audioFiles = audioResult.audioFiles;
    metadata.audioConcatFile = audioResult.audioConcatFile;
    metadata.audioDuration = audioResult.audioDuration;
    
    // PHASE 3: Video rendering (with component durations for sync)
    metadata.status = 'video';
    metadata.updatedAt = Date.now();
    const videoResult = await renderSegmentVideo(
      segmentId, 
      quiz, 
      audioResult.componentDurations,
      config
    );
    metadata.videoFile = videoResult.videoFile;
    metadata.videoDuration = videoResult.videoDuration;
    
    // PHASE 4: Muxing
    metadata.status = 'muxed';
    metadata.updatedAt = Date.now();
    const muxResult = await muxSegment(segmentId, metadata.videoFile, metadata.audioConcatFile, config);
    metadata.muxedFile = muxResult.muxedFile;
    metadata.finalDuration = muxResult.finalDuration;
    
    return metadata;
  } catch (error: any) {
    metadata.status = 'failed';
    metadata.error = error.message;
    metadata.updatedAt = Date.now();
    throw metadata; // Throw metadata so caller can log it
  }
}

/**
 * Process segments in parallel with concurrency limit
 */
async function processSegmentsParallel(
  quizzes: Quiz[],
  ttsService: TTSService,
  config: RenderConfig
): Promise<SegmentMetadata[]> {
  const results: SegmentMetadata[] = [];
  const concurrency = config.maxConcurrentSegments;
  
  // Process in batches
  for (let i = 0; i < quizzes.length; i += concurrency) {
    const batch = quizzes.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (quiz, batchIndex) => {
      const segmentId = `segment_${i + batchIndex}`;
      try {
        return await processSegment(segmentId, quiz, ttsService, config);
      } catch (metadata: any) {
        // Metadata was thrown, return it for logging
        return metadata as SegmentMetadata;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Main pipeline orchestrator
 */
export async function renderQuizVideo(
  quizzes: Quiz[],
  ttsService: TTSService,
  config: RenderConfig
): Promise<PipelineResult> {
  const errors: string[] = [];
  const segments: SegmentMetadata[] = [];
  
  // PHASE 1: Data normalization and validation
  console.log('📋 Phase 1: Data normalization...');
  const normalizedQuizzes: Quiz[] = [];
  
  for (let i = 0; i < quizzes.length; i++) {
    const quiz = quizzes[i];
    const validation = validateQuiz(quiz);
    
    if (!validation.valid) {
      errors.push(`Quiz ${i}: ${validation.error}`);
      continue;
    }
    
    normalizedQuizzes.push(normalizeQuiz(quiz));
  }
  
  if (normalizedQuizzes.length === 0) {
    return {
      success: false,
      segments: [],
      errors: ['No valid quizzes after normalization'],
    };
  }
  
  console.log(`✅ Validated ${normalizedQuizzes.length} quizzes`);
  
  // Ensure temp directory exists
  await fs.mkdir(config.tempDir, { recursive: true });
  await fs.mkdir(config.outputDir, { recursive: true });
  
  // PHASE 2-4: Process segments (parallel with concurrency limit)
  console.log('🎬 Phase 2-4: Processing segments...');
  const processedSegments = await processSegmentsParallel(normalizedQuizzes, ttsService, config);
  
  // Separate successful and failed segments
  const successfulSegments = processedSegments.filter(s => s.status === 'muxed');
  const failedSegments = processedSegments.filter(s => s.status === 'failed');
  
  segments.push(...processedSegments);
  
  // Log failures
  for (const segment of failedSegments) {
    errors.push(`Segment ${segment.segmentId}: ${segment.error}`);
    console.error(`❌ Segment ${segment.segmentId} failed: ${segment.error}`);
  }
  
  if (successfulSegments.length === 0) {
    return {
      success: false,
      segments,
      errors,
    };
  }
  
  console.log(`✅ Processed ${successfulSegments.length} segments (${failedSegments.length} failed)`);
  
  // PHASE 5: Final concatenation
  console.log('🔗 Phase 5: Concatenating segments...');
  
  try {
    // Prepare concat segments (include intro/outro if provided)
    const concatSegments: ConcatSegment[] = [];
    
    // Add intro if provided
    if (config.introVideo) {
      try {
        await fs.access(config.introVideo);
        concatSegments.push({
          file: config.introVideo,
          duration: 0, // Will be extracted if needed
        });
      } catch {
        console.warn(`⚠️  Intro video not found: ${config.introVideo}`);
      }
    }
    
    // Add all successful segments
    for (const segment of successfulSegments) {
      concatSegments.push({
        file: segment.muxedFile,
        duration: segment.finalDuration,
      });
    }
    
    // Add outro if provided
    if (config.outroVideo) {
      try {
        await fs.access(config.outroVideo);
        concatSegments.push({
          file: config.outroVideo,
          duration: 0,
        });
      } catch {
        console.warn(`⚠️  Outro video not found: ${config.outroVideo}`);
      }
    }
    
    // Concatenate
    const timestamp = Date.now();
    const outputFile = path.join(config.outputDir, `quiz_video_${timestamp}.mp4`);
    const finalFile = await concatVideoSegments(concatSegments, outputFile, config);
    
    // Extract final duration
    const { extractDuration } = await import('../utils/ffmpeg.js');
    const totalDuration = await extractDuration(finalFile);

    // Captions (sidecars + optional burn-in)
    try {
      if (config.captions?.enabled !== false) {
        const cues = buildCues(successfulSegments, { includeAnswers: true });
        const { srtPath } = await writeSrtAndVtt(finalFile, cues);
        if (config.captions?.burnIn) {
          const { burnInSubtitles } = await import('../utils/ffmpeg.js');
          await burnInSubtitles(finalFile, srtPath);
        }
      }
    } catch (e: any) {
      errors.push(`Captions failed: ${e?.message || String(e)}`);
    }
    
    console.log(`✅ Final video created: ${finalFile} (${totalDuration.toFixed(2)}s)`);
    
    return {
      success: true,
      outputFile: finalFile,
      segments,
      errors,
      totalDuration,
    };
  } catch (error: any) {
    errors.push(`Concatenation failed: ${error.message}`);
    return {
      success: false,
      segments,
      errors,
    };
  }
}

/**
 * Cleanup temp files for a segment
 */
export async function cleanupSegment(segmentId: string, config: RenderConfig): Promise<void> {
  const tempDir = path.join(config.tempDir, segmentId);
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error: any) {
    console.warn(`⚠️  Failed to cleanup ${tempDir}: ${error.message}`);
  }
}

/**
 * Cleanup all temp files
 */
export async function cleanupAll(config: RenderConfig): Promise<void> {
  try {
    await fs.rm(config.tempDir, { recursive: true, force: true });
  } catch (error: any) {
    console.warn(`⚠️  Failed to cleanup temp directory: ${error.message}`);
  }
}
