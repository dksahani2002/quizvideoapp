/**
 * List Videos Use Case
 * Retrieves videos by topic
 */

import { Video } from '../../domain/entities/index.js';
import { IVideoRepository } from '../../domain/repositories/index.js';

export class ListVideosUseCase {
  constructor(private videoRepository: IVideoRepository) {}

  async execute(topic?: string): Promise<Video[]> {
    if (topic) {
      return this.videoRepository.findByTopic(topic);
    }
    return this.videoRepository.findAll();
  }
}
