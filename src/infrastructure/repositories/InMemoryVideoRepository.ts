/**
 * In-Memory Video Repository
 * Simple in-memory implementation for development
 */

import { Video } from '../../domain/entities/Video.js';
import { IVideoRepository } from '../../domain/repositories/IVideoRepository.js';

export class InMemoryVideoRepository implements IVideoRepository {
  private videos: Map<string, Video> = new Map();

  async create(video: Video): Promise<void> {
    this.videos.set(video.getId(), video);
  }

  async findById(id: string): Promise<Video | null> {
    return this.videos.get(id) || null;
  }

  async findAll(): Promise<Video[]> {
    return Array.from(this.videos.values());
  }

  async findByTopic(topic: string): Promise<Video[]> {
    return Array.from(this.videos.values()).filter((v) => v.getTopic() === topic);
  }

  async update(video: Video): Promise<void> {
    this.videos.set(video.getId(), video);
  }

  async delete(id: string): Promise<void> {
    this.videos.delete(id);
  }
}
