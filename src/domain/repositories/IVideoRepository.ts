/**
 * Video Repository Interface
 * Abstraction for video data persistence
 */

import { Video } from '../entities/Video.js';

export interface IVideoRepository {
  /**
   * Create a new video
   */
  create(video: Video): Promise<void>;

  /**
   * Find video by ID
   */
  findById(id: string): Promise<Video | null>;

  /**
   * Find all videos
   */
  findAll(): Promise<Video[]>;

  /**
   * Find videos by topic
   */
  findByTopic(topic: string): Promise<Video[]>;

  /**
   * Update an existing video
   */
  update(video: Video): Promise<void>;

  /**
   * Delete video by ID
   */
  delete(id: string): Promise<void>;
}
