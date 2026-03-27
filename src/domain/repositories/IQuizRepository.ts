/**
 * Quiz Repository Interface
 * Abstraction for quiz data persistence
 */

import { Quiz } from '../entities/Quiz.js';

export interface IQuizRepository {
  /**
   * Create a new quiz
   */
  create(quiz: Quiz): Promise<void>;

  /**
   * Find quiz by ID
   */
  findById(id: string): Promise<Quiz | null>;

  /**
   * Find all quizzes for a topic
   */
  findByTopic(topic: string): Promise<Quiz[]>;

  /**
   * Save multiple quizzes
   */
  saveMany(quizzes: Quiz[]): Promise<void>;

  /**
   * Delete quiz by ID
   */
  delete(id: string): Promise<void>;
}
