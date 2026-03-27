/**
 * Adapter Service - Video Rendering
 * Adapts existing rendering pipeline to domain interface
 */

import { Video } from '../../domain/entities/Video.js';
import { IVideoRenderingService } from '../../domain/services/IVideoRenderingService.js';
import { renderQuizVideo } from '../../pipeline/orchestrator.js';
import { TTSService } from '../../services/ttsService.js';
import { RenderConfig } from '../../types/index.js';

export class AdaptedVideoRenderingService implements IVideoRenderingService {
  private ttsService: TTSService;

  constructor(ttsService: TTSService) {
    this.ttsService = ttsService;
  }

  async renderVideo(video: Video, renderConfig: any): Promise<string> {
    // Adapt Video entity to Quiz[] format expected by pipeline
    const quizzes = video.getQuizzes().map((q) => ({
      question: q.getQuestion(),
      options: [q.getOptions().a, q.getOptions().b, q.getOptions().c, q.getOptions().d] as [
        string,
        string,
        string,
        string
      ],
      answerIndex: this.getAnswerIndex(q.getCorrectAnswer()),
      language: q.getLanguage(),
    }));

    if (quizzes.length === 0) {
      throw new Error('No quizzes to render');
    }

    console.log(`🎬 Rendering video for ${quizzes.length} quizzes...`);

    // Build complete RenderConfig with defaults
    const config: RenderConfig = {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: 'libx264',
      sampleRate: 44100,
      channels: 2,
      loudnessTarget: -23,
      safetyPadding: 0.2,
      minSegmentDuration: 1.2,
      maxAnimationTime: 5,
      maxLineLength: 50,
      safeMargin: { top: 50, bottom: 100, left: 20, right: 20 },
      fontFile: './fonts/Arial.ttf',
      ttsProvider: 'system',
      maxConcurrentSegments: 3,
      tempDir: renderConfig?.tempDir || './temp',
      outputDir: renderConfig?.outputDir || './output/videos',
      cacheDir: renderConfig?.cacheDir || './cache/tts',
      introVideo: renderConfig?.introVideo,
      outroVideo: renderConfig?.outroVideo,
      maxTotalDuration: 60,
      speedUpIfExceeds: true,
    };

    const result = await renderQuizVideo(quizzes, this.ttsService, config);

    if (!result.success || !result.outputFile) {
      throw new Error(`Video rendering failed: ${result.errors.join(', ')}`);
    }

    console.log(`✅ Video rendered successfully: ${result.outputFile}`);
    return result.outputFile;
  }

  async getProgress(_videoId: string): Promise<{ completed: number; total: number; percentage: number }> {
    // TODO: Implement progress tracking
    return {
      completed: 0,
      total: 0,
      percentage: 0,
    };
  }

  private getAnswerIndex(correctAnswer: string): 0 | 1 | 2 | 3 {
    const map: Record<string, 0 | 1 | 2 | 3> = {
      a: 0,
      b: 1,
      c: 2,
      d: 3,
    };
    return map[correctAnswer] || 0;
  }
}

