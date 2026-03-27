/**
 * In-Memory Quiz Repository
 * Simple in-memory implementation for development
 */

import { Quiz } from '../../domain/entities/Quiz.js';
import { IQuizRepository } from '../../domain/repositories/IQuizRepository.js';

export class InMemoryQuizRepository implements IQuizRepository {
  private quizzes: Map<string, Quiz> = new Map();

  async create(quiz: Quiz): Promise<void> {
    this.quizzes.set(quiz.getId(), quiz);
  }

  async findById(id: string): Promise<Quiz | null> {
    return this.quizzes.get(id) || null;
  }

  async findByTopic(_topic: string): Promise<Quiz[]> {
    // Not implemented for in-memory, would need topic tracking
    return Array.from(this.quizzes.values());
  }

  async saveMany(quizzes: Quiz[]): Promise<void> {
    quizzes.forEach((quiz) => {
      this.quizzes.set(quiz.getId(), quiz);
    });
  }

  async delete(id: string): Promise<void> {
    this.quizzes.delete(id);
  }
}
