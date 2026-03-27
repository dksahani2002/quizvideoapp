/**
 * Quiz Domain Entity
 * Core business entity representing a quiz question
 */

export interface QuizOptions {
  a: string;
  b: string;
  c: string;
  d: string;
}

export type CorrectAnswer = 'a' | 'b' | 'c' | 'd';

export class Quiz {
  private readonly id: string;
  private readonly question: string;
  private readonly options: QuizOptions;
  private readonly correctAnswer: CorrectAnswer;
  private readonly language: string;
  private readonly createdAt: Date;

  constructor(
    id: string,
    question: string,
    options: QuizOptions,
    correctAnswer: CorrectAnswer,
    language: string = 'en',
    createdAt: Date = new Date()
  ) {
    if (!question || question.trim().length === 0) {
      throw new Error('Quiz question cannot be empty');
    }
    if (!this.isValidOptions(options)) {
      throw new Error('Quiz must have exactly 4 options (a, b, c, d)');
    }
    if (!['a', 'b', 'c', 'd'].includes(correctAnswer)) {
      throw new Error('Correct answer must be one of: a, b, c, d');
    }

    this.id = id;
    this.question = question;
    this.options = options;
    this.correctAnswer = correctAnswer;
    this.language = language;
    this.createdAt = createdAt;
  }

  private isValidOptions(options: QuizOptions): boolean {
    return (
      options &&
      typeof options.a === 'string' &&
      typeof options.b === 'string' &&
      typeof options.c === 'string' &&
      typeof options.d === 'string' &&
      options.a.trim().length > 0 &&
      options.b.trim().length > 0 &&
      options.c.trim().length > 0 &&
      options.d.trim().length > 0
    );
  }

  getId(): string {
    return this.id;
  }

  getQuestion(): string {
    return this.question;
  }

  getOptions(): QuizOptions {
    return this.options;
  }

  getCorrectAnswer(): CorrectAnswer {
    return this.correctAnswer;
  }

  getCorrectAnswerText(): string {
    return this.options[this.correctAnswer];
  }

  getLanguage(): string {
    return this.language;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  toJSON() {
    return {
      id: this.id,
      question: this.question,
      options: this.options,
      correctAnswer: this.correctAnswer,
      language: this.language,
      createdAt: this.createdAt,
    };
  }
}
