/**
 * Example: Using Clean Architecture
 * 
 * This file demonstrates how to use the refactored codebase
 * and shows the power of clean architecture in action
 */

// ============================================
// Example 1: Basic Usage (Application Entry Point)
// ============================================
import { ApplicationFactory } from './infrastructure/ApplicationFactory.js';
import { loadEnvConfig } from './config/envConfig.js';

async function example1_basicUsage() {
  const env = loadEnvConfig();
  const dependencies = ApplicationFactory.createDependencies(env);

  // Use the generate video use case
  const result = await dependencies.generateVideoUseCase.execute({
    topic: 'JavaScript Async/Await',
    questionCount: 5,
    title: 'Advanced JS Concepts',
  });

  console.log('Video Generation Result:', result);
}

// ============================================
// Example 2: Testing with Mocks
// ============================================
import { GenerateVideoUseCase } from './application/use-cases/GenerateVideoUseCase.js';
import { InMemoryQuizRepository, InMemoryVideoRepository } from './infrastructure/repositories/index.js';
import { Quiz } from './domain/entities/Quiz.js';

class MockMCQGenerationService {
  async generateMCQs(topic: string, count: number) {
    return Array.from({ length: count }).map((_, i) => {
      return new Quiz(
        `mock_${i}`,
        `Mock Question ${i + 1} about ${topic}?`,
        { a: 'Option A', b: 'Option B', c: 'Option C', d: 'Option D' },
        'b',
        'en'
      );
    });
  }
}

class MockVideoRenderingService {
  async renderVideo() {
    return '/mock/path/to/video.mp4';
  }

  async getProgress() {
    return { completed: 5, total: 5, percentage: 100 };
  }
}

async function example2_testingWithMocks() {
  const mockMCQService = new MockMCQGenerationService();
  const mockRenderService = new MockVideoRenderingService();
  const quizRepo = new InMemoryQuizRepository();
  const videoRepo = new InMemoryVideoRepository();

  const useCase = new GenerateVideoUseCase(
    mockMCQService,
    mockRenderService,
    quizRepo,
    videoRepo
  );

  const result = await useCase.execute({
    topic: 'Test Topic',
    questionCount: 5,
  });

  console.log('Test Result:', result);
}

// ============================================
// Example 3: Switching Implementations
// ============================================

// You can easily switch the MCQ service provider:

// Option 1: OpenAI (default)
import { OpenAIMCQGenerationService } from './infrastructure/services/OpenAIMCQGenerationService.js';

const openAIService = new OpenAIMCQGenerationService({
  apiKey: 'sk-...',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-3.5-turbo',
});

// Option 2: Mock (for testing)
const mockService = new MockMCQGenerationService();

// Option 3: Different provider (add new class implementing IMCQGenerationService)
// class AnthropicMCQGenerationService implements IMCQGenerationService { ... }
// const anthropicService = new AnthropicMCQGenerationService(config);

// All work seamlessly with GenerateVideoUseCase!

// ============================================
// Example 4: Switching Repositories
// ============================================

// Option 1: In-Memory (fast, loses data on restart)
const inMemoryRepo = new InMemoryVideoRepository();

// Option 2: File-based (persistent, slower)
import { FileBasedQuizRepository } from './infrastructure/repositories/FileBasedQuizRepository.js';
const fileBasedRepo = new FileBasedQuizRepository('./data');

// Option 3: Database (add new class implementing IVideoRepository)
// class MongoDBVideoRepository implements IVideoRepository { ... }
// const mongoRepo = new MongoDBVideoRepository(mongoClient);

// All work seamlessly with use cases!

// ============================================
// Example 5: Domain Entity Validation
// ============================================

function example5_domainValidation() {
  try {
    // This will throw: question is empty
    const invalidQuiz = new Quiz(
      'id',
      '', // Invalid!
      { a: 'A', b: 'B', c: 'C', d: 'D' },
      'a'
    );
  } catch (error) {
    console.log('Caught validation error:', (error as Error).message);
  }

  try {
    // This will throw: incorrect answer format
    const invalidQuiz = new Quiz(
      'id',
      'Valid question?',
      { a: 'A', b: 'B', c: 'C', d: 'D' },
      'e' // Invalid! Only a-d allowed
    );
  } catch (error) {
    console.log('Caught validation error:', (error as Error).message);
  }

  // Valid quiz
  const validQuiz = new Quiz(
    'q1',
    'What is the capital of France?',
    { a: 'London', b: 'Paris', c: 'Berlin', d: 'Rome' },
    'b'
  );

  console.log('Valid quiz created:', validQuiz.getId());
}

// ============================================
// Example 6: Using Presenters for Response Formatting
// ============================================

import { VideoPresenter } from './interface-adapters/presenters/VideoPresenter.js';
import { Video } from './domain/entities/Video.js';

function example6_presenterUsage() {
  const video = new Video(
    'vid_123',
    'JavaScript Quiz',
    'JavaScript Fundamentals',
    []
  );

  // Presenter handles all formatting for HTTP response
  const response = VideoPresenter.present(video);

  console.log('Formatted response:', response);
  // {
  //   id: 'vid_123',
  //   title: 'JavaScript Quiz',
  //   topic: 'JavaScript Fundamentals',
  //   status: 'pending',
  //   filePath: null,
  //   metadata: null,
  //   error: null,
  //   createdAt: '2024-01-30T12:34:56.789Z',
  //   updatedAt: '2024-01-30T12:34:56.789Z',
  //   quizzesCount: 0
  // }
}

// ============================================
// Example 7: Complete Dependency Injection Setup
// ============================================

import { EnvConfig } from './config/envConfig.js';

function createApplicationDependencies(env: EnvConfig) {
  // Step 1: Create repositories
  const quizRepository = new InMemoryQuizRepository();
  const videoRepository = new InMemoryVideoRepository();

  // Step 2: Create services
  const mcqService = new OpenAIMCQGenerationService({
    apiKey: env.OPENAI_API_KEY,
    apiUrl: env.OPENAI_URL,
    model: 'gpt-3.5-turbo',
  });

  const renderService = new MockVideoRenderingService();

  // Step 3: Create use cases
  const generateVideoUseCase = new GenerateVideoUseCase(
    mcqService,
    renderService,
    quizRepository,
    videoRepository
  );

  // Step 4: Use in controller
  return { generateVideoUseCase };
}

// ============================================
// Benefits Summary
// ============================================

/*
1. TESTABILITY
   - Every layer can be tested independently
   - Mock implementations for testing
   - No external dependencies needed

2. MAINTAINABILITY
   - Clear separation of concerns
   - Easy to find and modify code
   - Changes in one layer don't affect others

3. FLEXIBILITY
   - Swap implementations without changing code
   - Add new features without modifying existing
   - Multiple implementations can coexist

4. SCALABILITY
   - Easy to add new use cases
   - New repositories don't break existing code
   - Services can be distributed independently

5. REUSABILITY
   - Use cases can be used in different contexts
   - Entities are framework-independent
   - Services can be shared across projects

6. FUTURE-PROOF
   - Easy to migrate to new frameworks
   - Easy to add event sourcing
   - Easy to implement CQRS pattern
*/

export {
  example1_basicUsage,
  example2_testingWithMocks,
  example5_domainValidation,
  example6_presenterUsage,
  createApplicationDependencies,
};
