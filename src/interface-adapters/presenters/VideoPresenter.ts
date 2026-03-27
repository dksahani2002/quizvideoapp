/**
 * Video Presenter
 * Formats domain models for HTTP responses
 */

import { Video } from '../../domain/entities/Video.js';

export interface VideoPresenterResponse {
  id: string;
  title: string;
  topic: string;
  status: string;
  filePath: string | null;
  metadata: any;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  quizzesCount: number;
}

export class VideoPresenter {
  static present(video: Video): VideoPresenterResponse {
    return {
      id: video.getId(),
      title: video.getTitle(),
      topic: video.getTopic(),
      status: video.getStatus(),
      filePath: video.getFilePath(),
      metadata: video.getMetadata(),
      error: video.getError(),
      createdAt: video.getCreatedAt().toISOString(),
      updatedAt: video.getUpdatedAt().toISOString(),
      quizzesCount: video.getQuizzes().length,
    };
  }

  static presentMany(videos: Video[]): VideoPresenterResponse[] {
    return videos.map((v) => this.present(v));
  }
}
