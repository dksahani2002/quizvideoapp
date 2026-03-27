/**
 * Video Domain Entity
 * Represents a generated video containing quiz segments
 */

import { Quiz } from './Quiz.js';

export enum VideoStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  totalSegments: number;
  completedSegments: number;
}

export class Video {
  private readonly id: string;
  private readonly title: string;
  private readonly topic: string;
  private readonly quizzes: Quiz[];
  private status: VideoStatus;
  private filePath: string | null;
  private metadata: VideoMetadata | null;
  private error: string | null;
  private readonly createdAt: Date;
  private updatedAt: Date;

  constructor(
    id: string,
    title: string,
    topic: string,
    quizzes: Quiz[],
    createdAt: Date = new Date()
  ) {
    if (!title || title.trim().length === 0) {
      throw new Error('Video title cannot be empty');
    }
    if (!topic || topic.trim().length === 0) {
      throw new Error('Video topic cannot be empty');
    }
    if (!quizzes || quizzes.length === 0) {
      throw new Error('Video must have at least one quiz');
    }

    this.id = id;
    this.title = title;
    this.topic = topic;
    this.quizzes = quizzes;
    this.status = VideoStatus.PENDING;
    this.filePath = null;
    this.metadata = null;
    this.error = null;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
  }

  getId(): string {
    return this.id;
  }

  getTitle(): string {
    return this.title;
  }

  getTopic(): string {
    return this.topic;
  }

  getQuizzes(): Quiz[] {
    return this.quizzes;
  }

  getStatus(): VideoStatus {
    return this.status;
  }

  setStatus(status: VideoStatus): void {
    this.status = status;
    this.updatedAt = new Date();
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  setFilePath(filePath: string): void {
    this.filePath = filePath;
    this.updatedAt = new Date();
  }

  getMetadata(): VideoMetadata | null {
    return this.metadata;
  }

  setMetadata(metadata: VideoMetadata): void {
    this.metadata = metadata;
    this.updatedAt = new Date();
  }

  getError(): string | null {
    return this.error;
  }

  setError(error: string): void {
    this.error = error;
    this.status = VideoStatus.FAILED;
    this.updatedAt = new Date();
  }

  isComplete(): boolean {
    return this.status === VideoStatus.COMPLETED && this.filePath !== null;
  }

  isFailed(): boolean {
    return this.status === VideoStatus.FAILED;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      topic: this.topic,
      status: this.status,
      filePath: this.filePath,
      metadata: this.metadata,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      quizzesCount: this.quizzes.length,
    };
  }
}
