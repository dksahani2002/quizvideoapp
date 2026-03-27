/**
 * Application Factory & Dependency Injection
 * Creates and wires all dependencies
 */

import { EnvConfig } from '../config/envConfig.js';
import { GenerateVideoUseCase, GetVideoUseCase, ListVideosUseCase } from '../application/use-cases/index.js';
import { InMemoryQuizRepository, InMemoryVideoRepository } from './repositories/index.js';
import { OpenAIMCQGenerationService, AdaptedVideoRenderingService, AdaptedTTSService } from './services/index.js';

export interface ApplicationDependencies {
  generateVideoUseCase: GenerateVideoUseCase;
  getVideoUseCase: GetVideoUseCase;
  listVideosUseCase: ListVideosUseCase;
}

export class ApplicationFactory {
  static createDependencies(envConfig: EnvConfig): ApplicationDependencies {
    // Repositories
    const quizRepository = new InMemoryQuizRepository();
    const videoRepository = new InMemoryVideoRepository();

    // Services
    const mcqGenerationService = new OpenAIMCQGenerationService({
      apiKey: envConfig.OPENAI_API_KEY,
      apiUrl: envConfig.OPENAI_URL,
      model: 'gpt-3.5-turbo',
    });

    const ttsService = new AdaptedTTSService();
    const videoRenderingService = new AdaptedVideoRenderingService(ttsService);

    // Use Cases
    const generateVideoUseCase = new GenerateVideoUseCase(
      mcqGenerationService,
      videoRenderingService,
      quizRepository,
      videoRepository
    );

    const getVideoUseCase = new GetVideoUseCase(videoRepository);
    const listVideosUseCase = new ListVideosUseCase(videoRepository);

    return {
      generateVideoUseCase,
      getVideoUseCase,
      listVideosUseCase,
    };
  }
}
