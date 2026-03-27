/**
 * Generate Video Use Case
 * Core business logic for video generation
 */

import { Video, VideoStatus } from '../../domain/entities/index.js';
import { IQuizRepository, IVideoRepository } from '../../domain/repositories/index.js';
import { IMCQGenerationService, IVideoRenderingService } from '../../domain/services/index.js';

export interface GenerateVideoRequest {
  topic: string;
  questionCount: number;
  title?: string;
}

export interface GenerateVideoResponse {
  videoId: string;
  status: VideoStatus;
  filePath: string | null;
  error: string | null;
}

export class GenerateVideoUseCase {
  constructor(
    private mcqGenerationService: IMCQGenerationService,
    private videoRenderingService: IVideoRenderingService,
    private quizRepository: IQuizRepository,
    private videoRepository: IVideoRepository
  ) {}

  async execute(request: GenerateVideoRequest): Promise<GenerateVideoResponse> {
    const videoId = this.generateVideoId();
    const title = request.title || `Quiz Video - ${request.topic}`;

    try {
      // Step 1: Generate MCQs FIRST (before creating Video entity)
      console.log(`🤖 Generating ${request.questionCount} MCQs for topic: "${request.topic}"`);
      const quizzes = await this.mcqGenerationService.generateMCQs(
        request.topic,
        request.questionCount
      );

      if (quizzes.length === 0) {
        throw new Error('Failed to generate MCQs');
      }

      // Create video entity with generated quizzes
      const video = new Video(videoId, title, request.topic, quizzes);
      video.setStatus(VideoStatus.GENERATING);
      await this.videoRepository.create(video);

      // Save quizzes
      await this.quizRepository.saveMany(quizzes);

      // Step 2: Render video
      console.log(`📹 Rendering video with ${quizzes.length} quizzes`);
      video.setStatus(VideoStatus.PROCESSING);
      await this.videoRepository.update(video);

      const filePath = await this.videoRenderingService.renderVideo(video, {});

      // Update video with final path
      video.setFilePath(filePath);
      video.setStatus(VideoStatus.COMPLETED);
      video.setMetadata({
        duration: 0,
        width: 1080,
        height: 1920,
        fps: 30,
        totalSegments: quizzes.length,
        completedSegments: quizzes.length,
      });
      await this.videoRepository.update(video);

      console.log(`✅ Video generation completed: ${filePath}`);

      return {
        videoId,
        status: VideoStatus.COMPLETED,
        filePath,
        error: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Video generation failed: ${errorMessage}`);

      // Update video with error status
      const video = new Video(videoId, title, request.topic, []);
      video.setError(errorMessage);
      await this.videoRepository.update(video);

      return {
        videoId,
        status: VideoStatus.FAILED,
        filePath: null,
        error: errorMessage,
      };
    }
  }

  private generateVideoId(): string {
    return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
