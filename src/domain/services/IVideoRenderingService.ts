/**
 * Video Rendering Service Interface
 * Abstraction for video rendering logic
 */

import { Video } from '../entities/Video.js';

export interface IVideoRenderingService {
  /**
   * Render a complete video from quizzes
   */
  renderVideo(video: Video, renderConfig: any): Promise<string>;

  /**
   * Get rendering progress
   */
  getProgress(videoId: string): Promise<{
    completed: number;
    total: number;
    percentage: number;
  }>;
}
