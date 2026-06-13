import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

import type { EnvConfig } from '../../common/config/envConfig.js';
import { StoryVideoJob } from '../../common/db/models/StoryVideoJob.js';
import { Video } from '../../common/db/models/Video.js';
import { loadSettings } from '../../common/services/settingsService.js';
import { downloadObjectToFile } from '../../common/services/s3Storage.js';
import {
  uploadToAllPlatforms,
  uploadToInstagramOnly,
  uploadToYouTubeOnly,
  type UploadOrchestrationResult,
} from '../../common/services/uploadOrchestrator.js';

export interface UploadServiceRequest {
  platforms?: ('youtube' | 'instagram')[];
  userId?: string;
  /** When set, upload this story-video job's output MP4 instead of the latest quiz video. */
  storyVideoJobId?: string;
}

export interface PlatformUploadResponse {
  youtube?: {
    success: boolean;
    videoId?: string;
    url?: string;
    error?: string;
  };
  instagram?: {
    success: boolean;
    mediaId?: string;
    url?: string;
    error?: string;
  };
}

export interface UploadServiceResponse {
  success: boolean;
  platforms: PlatformUploadResponse;
  errors: string[];
}

export async function uploadToPlatforms(
  request: UploadServiceRequest,
  envConfig: EnvConfig
): Promise<UploadServiceResponse> {
  try {
    const platforms = request.platforms || ['youtube', 'instagram'];
    const topic = request.storyVideoJobId ? 'Story video' : envConfig.TOPIC || 'Quiz';
    const userId = request.userId;

    // Multi-tenant: credentials must be configured per-user in Settings.
    const userSettings = userId ? await loadSettings(userId) : null;
    const youtubeCredentials = {
      clientId: userSettings?.youtube.clientId || '',
      clientSecret: userSettings?.youtube.clientSecret || '',
      redirectUri: userSettings?.youtube.redirectUri || '',
      refreshToken: userSettings?.youtube.refreshToken || '',
    };

    if (platforms.includes('youtube')) {
      if (
        !youtubeCredentials.clientId ||
        !youtubeCredentials.clientSecret ||
        !youtubeCredentials.redirectUri ||
        !youtubeCredentials.refreshToken
      ) {
        throw new Error(
          'YouTube is not configured for this user. Add credentials in Settings and connect YouTube in Publishing.'
        );
      }
    }

    // Instagram publishing should be done via Meta Graph API in Publishing.
    // Keep this endpoint explicit: if requested here, instruct user to use Publishing.
    const instagramCredentials = {};
    if (platforms.includes('instagram')) {
      throw new Error(
        'Instagram upload is not supported via /api/uploads. Use Publishing (Meta Graph API) to connect and publish.'
      );
    }

    // Resolve the directory containing the MP4 for upload: explicit story job, else latest quiz Video.
    // On AWS, videos are stored in S3 and referenced by Video.s3Bucket/s3Key or StoryVideoJob.outputVideoKey.
    let resolvedOutputDir = envConfig.OUTPUT_DIR;
    if (userId) {
      if (request.storyVideoJobId) {
        if (!mongoose.Types.ObjectId.isValid(request.storyVideoJobId)) {
          throw new Error('Invalid story video job id');
        }
        const sj = await StoryVideoJob.findOne({
          _id: request.storyVideoJobId,
          userId: new mongoose.Types.ObjectId(userId),
          status: 'completed',
        }).lean();
        if (!sj) {
          throw new Error('Story video job not found or not completed');
        }
        const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId, 'story-publish');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const outName = `story-${String(sj._id)}.mp4`;
        const outPath = path.join(tmpDir, outName);
        if (sj.s3Bucket && sj.outputVideoKey) {
          await downloadObjectToFile(sj.s3Bucket, sj.outputVideoKey, outPath);
        } else {
          const inter = sj.intermediate as { finalPath?: string } | undefined;
          const fp = inter?.finalPath;
          if (!fp || !fs.existsSync(fp)) {
            throw new Error(
              'Story video output is not on disk (use S3 output bucket) or path missing — cannot upload to YouTube'
            );
          }
          fs.copyFileSync(fp, outPath);
        }
        resolvedOutputDir = tmpDir;
      } else {
        const latest = await Video.findOne({ userId, status: 'completed' }).sort({ createdAt: -1 }).lean();
        if (latest?.s3Bucket && latest?.s3Key) {
          const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId);
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const outPath = path.join(tmpDir, latest.filename || 'latest.mp4');
          await downloadObjectToFile(latest.s3Bucket, latest.s3Key, outPath);
          resolvedOutputDir = tmpDir;
        } else {
          // Local disk mode (dev)
          resolvedOutputDir = path.join(envConfig.OUTPUT_DIR, userId);
        }
      }
    }

    let result: UploadOrchestrationResult;

    if (platforms.length === 1) {
      if (platforms[0] === 'youtube') {
        const youtubeResult = await uploadToYouTubeOnly(resolvedOutputDir, topic, youtubeCredentials);
        result = {
          success: youtubeResult.success,
          youtube: youtubeResult,
          errors: youtubeResult.error ? [youtubeResult.error] : [],
        };
      } else {
        const instagramResult = await uploadToInstagramOnly(resolvedOutputDir, topic, instagramCredentials);
        result = {
          success: instagramResult.success,
          instagram: instagramResult,
          errors: instagramResult.error ? [instagramResult.error] : [],
        };
      }
    } else {
      result = await uploadToAllPlatforms(
        {
          youtube: platforms.includes('youtube'),
          instagram: platforms.includes('instagram'),
        },
        resolvedOutputDir,
        topic,
        youtubeCredentials,
        instagramCredentials
      );
    }

    const platformResponse: PlatformUploadResponse = {};

    if (result.youtube) {
      platformResponse.youtube = {
        success: result.youtube.success,
        videoId: result.youtube.videoId,
        url: result.youtube.url,
        error: result.youtube.error,
      };
    }

    if (result.instagram) {
      platformResponse.instagram = {
        success: result.instagram.success,
        mediaId: result.instagram.mediaId,
        url: result.instagram.url,
        error: result.instagram.error,
      };
    }

    return {
      success: result.success,
      platforms: platformResponse,
      errors: result.errors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      platforms: {},
      errors: [errorMessage],
    };
  }
}
