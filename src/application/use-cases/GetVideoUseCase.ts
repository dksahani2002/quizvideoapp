/**
 * Get Video Use Case
 * Retrieves video details
 */

import { Video } from '../../domain/entities/index.js';
import { IVideoRepository } from '../../domain/repositories/index.js';

export class GetVideoUseCase {
  constructor(private videoRepository: IVideoRepository) {}

  async execute(videoId: string): Promise<Video | null> {
    return this.videoRepository.findById(videoId);
  }
}
