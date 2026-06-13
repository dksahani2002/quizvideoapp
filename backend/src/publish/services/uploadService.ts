import type { EnvConfig } from '../../common/config/envConfig.js';
import { loadSettings } from '../../common/services/settingsService.js';
import { resolvePublishOutput } from './resolveVideoSource.js';
import {
  uploadToAllPlatforms,
  uploadToInstagramOnly,
  uploadToYouTubeOnly,
  type UploadOrchestrationResult,
} from '../orchestrator/uploadOrchestrator.js';

export interface UploadServiceRequest {
  platforms?: ('youtube' | 'instagram')[];
  userId?: string;
  /** When set, upload this story-video job's output MP4 instead of the latest quiz video. */
  storyVideoJobId?: string;
  /** When set, upload this trailer-breakdown job's output MP4. */
  trailerBreakdownJobId?: string;
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
    if (request.storyVideoJobId && request.trailerBreakdownJobId) {
      throw new Error('Provide either storyVideoJobId or trailerBreakdownJobId, not both');
    }
    const topic = request.trailerBreakdownJobId
      ? 'Trailer breakdown'
      : request.storyVideoJobId
        ? 'Story video'
        : envConfig.TOPIC || 'Quiz';
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

    let resolvedOutputDir = envConfig.OUTPUT_DIR;
    let uploadTitle = topic;
    if (userId) {
      const resolved = await resolvePublishOutput(
        userId,
        {
          storyVideoJobId: request.storyVideoJobId,
          trailerBreakdownJobId: request.trailerBreakdownJobId,
        },
        envConfig
      );
      resolvedOutputDir = resolved.outputDir;
      uploadTitle = resolved.title;
    }

    let result: UploadOrchestrationResult;

    if (platforms.length === 1) {
      if (platforms[0] === 'youtube') {
        const youtubeResult = await uploadToYouTubeOnly(resolvedOutputDir, uploadTitle, youtubeCredentials);
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
        uploadTitle,
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
