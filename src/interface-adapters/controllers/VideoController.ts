/**
 * Refactored Video Controller
 * Uses use cases and follows clean architecture
 */

import { Request, Response } from 'express';
import { GenerateVideoUseCase, GetVideoUseCase, ListVideosUseCase } from '../../application/use-cases/index.js';
import { VideoPresenter } from '../presenters/VideoPresenter.js';

export class VideoController {
  constructor(
    private generateVideoUseCase: GenerateVideoUseCase,
    private getVideoUseCase: GetVideoUseCase,
    private listVideosUseCase: ListVideosUseCase
  ) {}

  async generateVideo(req: Request, res: Response): Promise<void> {
    try {
      const { topic, questionCount = 5, title } = req.body;

      if (!topic) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: topic',
        });
        return;
      }

      const response = await this.generateVideoUseCase.execute({
        topic,
        questionCount,
        title,
      });

      if (response.error) {
        res.status(500).json({
          success: false,
          videoId: response.videoId,
          error: response.error,
        });
        return;
      }

      res.status(200).json({
        success: true,
        videoId: response.videoId,
        status: response.status,
        filePath: response.filePath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  async getVideo(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const video = await this.getVideoUseCase.execute(id);

      if (!video) {
        res.status(404).json({
          success: false,
          error: 'Video not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: VideoPresenter.present(video),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  async listVideos(req: Request, res: Response): Promise<void> {
    try {
      const { topic } = req.query;

      const videos = await this.listVideosUseCase.execute(topic as string | undefined);

      res.status(200).json({
        success: true,
        data: VideoPresenter.presentMany(videos),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
}
