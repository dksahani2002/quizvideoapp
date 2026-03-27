/**
 * File-based Quiz Repository
 * Persists quizzes to JSON files
 */

import fs from 'fs/promises';
import path from 'path';
import { Quiz, CorrectAnswer } from '../../domain/entities/Quiz.js';
import { IQuizRepository } from '../../domain/repositories/IQuizRepository.js';

interface QuizDTO {
  id: string;
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: CorrectAnswer;
  language: string;
  createdAt: string;
}

export class FileBasedQuizRepository implements IQuizRepository {
  constructor(private storagePath: string) {}

  private getQuizPath(topic: string): string {
    return path.join(this.storagePath, `${topic}.json`);
  }

  async create(_quiz: Quiz): Promise<void> {
    // DTO structure for future persistence:
    // { id, question, options, correctAnswer, language, createdAt }

    // For now, just ensure storage directory exists
    await fs.mkdir(this.storagePath, { recursive: true });
  }

  async findById(_id: string): Promise<Quiz | null> {
    // Implementation would search through all quiz files
    return null;
  }

  async findByTopic(topic: string): Promise<Quiz[]> {
    try {
      const filePath = this.getQuizPath(topic);
      const content = await fs.readFile(filePath, 'utf-8');
      const dtos: QuizDTO[] = JSON.parse(content);

      return dtos.map(
        (dto) =>
          new Quiz(dto.id, dto.question, dto.options, dto.correctAnswer, dto.language, new Date(dto.createdAt))
      );
    } catch (error) {
      return [];
    }
  }

  async saveMany(quizzes: Quiz[]): Promise<void> {
    // Group quizzes by topic (if available from metadata)
    await fs.mkdir(this.storagePath, { recursive: true });

    const dtos = quizzes.map((quiz) => {
      const data = quiz.toJSON() as any;
      return {
        id: data.id,
        question: data.question,
        options: data.options,
        correctAnswer: data.correctAnswer,
        language: data.language,
        createdAt: data.createdAt,
      };
    });

    const filePath = path.join(this.storagePath, 'all_quizzes.json');
    await fs.writeFile(filePath, JSON.stringify(dtos, null, 2), 'utf-8');
  }

  async delete(_id: string): Promise<void> {
    // Implementation would find and remove the quiz
  }
}
