/**
 * Refactored Video Routes
 * Uses clean architecture controllers
 */

import { Router } from 'express';
import { ApplicationDependencies } from '../../infrastructure/ApplicationFactory.js';
import { VideoController } from '../controllers/VideoController.js';

export function createCleanArchitectureVideoRoutes(dependencies: ApplicationDependencies): Router {
  const router = Router();
  const videoController = new VideoController(
    dependencies.generateVideoUseCase,
    dependencies.getVideoUseCase,
    dependencies.listVideosUseCase
  );

  /**
   * POST /api/videos/generate
   * Generate a video with quiz questions for a given topic
   */
  router.post('/generate', (req, res) => videoController.generateVideo(req, res));

  /**
   * GET /api/videos/:id
   * Get video details by ID
   */
  router.get('/:id', (req, res) => videoController.getVideo(req, res));

  /**
   * GET /api/videos
   * List all videos or filter by topic
   */
  router.get('/', (req, res) => videoController.listVideos(req, res));

  return router;
}
