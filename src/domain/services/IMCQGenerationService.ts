/**
 * MCQ Generation Service Interface
 * Abstraction for MCQ generation logic
 */

import { Quiz } from '../entities/Quiz.js';

export interface IMCQGenerationService {
  /**
   * Generate MCQs for a given topic
   */
  generateMCQs(topic: string, questionCount: number): Promise<Quiz[]>;
}
