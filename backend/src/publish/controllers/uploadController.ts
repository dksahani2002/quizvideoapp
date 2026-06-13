/**
 * Upload Controller
 * Handles HTTP requests for uploading to social media platforms
 */

import { Router, type Request, type Response } from 'express';

import type { EnvConfig } from '../../common/config/envConfig.js';
import {
  uploadToPlatforms,
  type UploadServiceRequest,
  type UploadServiceResponse,
} from '../services/uploadService.js';

export type UploadControllerRequest = UploadServiceRequest;
export type UploadControllerResponse = UploadServiceResponse;

// Backward-compatible alias for older imports.
export async function uploadController(
  request: UploadControllerRequest,
  envConfig: EnvConfig
): Promise<UploadControllerResponse> {
  return uploadToPlatforms(request, envConfig);
}

export function classifyYouTubeFailure(errors: string[], youtubeErr?: string): { status: number; hint?: string } {
  const msg = [...(errors || []), youtubeErr || ''].join('\n').toLowerCase();

  if (msg.includes('not configured') || msg.includes('add credentials') || msg.includes('connect youtube')) {
    return {
      status: 400,
      hint: 'Open Settings -> YouTube API credentials, then Publishing -> connect YouTube.',
    };
  }

  if (msg.includes('no video file found') || msg.includes('video file not found')) {
    return { status: 404, hint: 'Generate a completed video first, or check that the file exists on the server.' };
  }

  if (
    msg.includes('invalid_grant') ||
    msg.includes('invalid credentials') ||
    msg.includes('token has been expired') ||
    msg.includes('token has been revoked')
  ) {
    return {
      status: 401,
      hint: 'Reconnect YouTube in Publishing (OAuth refresh token may be invalid).',
    };
  }

  if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('exceeded')) {
    return { status: 429, hint: 'YouTube API quota or rate limit - try again later.' };
  }

  if (msg.includes('access denied') || msg.includes('forbidden') || msg.includes('insufficient')) {
    return { status: 403 };
  }

  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('network')) {
    return { status: 503, hint: 'Network error talking to Google. Check connectivity and DNS.' };
  }

  return { status: 502, hint: 'YouTube API rejected the upload. See the error message and server logs.' };
}

export function classifyInstagramFailure(errors: string[]): { status: number; hint?: string } {
  const msg = (errors || []).join('\n');
  const m = msg.toLowerCase();

  if (m.includes('instagram upload is not supported')) {
    return { status: 400, hint: 'Use Publishing to connect Instagram (Meta Graph API) and publish.' };
  }

  if (
    m.includes('blacklist') ||
    m.includes('added to the blacklist') ||
    m.includes('we can send you an email') ||
    m.includes('checkpoint_required') ||
    m.includes('challenge_required') ||
    m.includes('two_factor_required') ||
    m.includes('login_required')
  ) {
    return {
      status: 403,
      hint:
        'Instagram blocked automated login. Try logging in manually from this IP, complete any security checks/2FA, then retry. If it persists, change network/IP or use manual upload.',
    };
  }

  if (m.includes('rate') && m.includes('limit')) {
    return { status: 429, hint: 'Rate limited by Instagram. Wait and retry later.' };
  }

  return { status: 500 };
}

export function createUploadRoutes(envConfig: EnvConfig): Router {
  const router = Router();

  function uploadIdsFromBody(body: unknown): Pick<UploadServiceRequest, 'storyVideoJobId' | 'trailerBreakdownJobId'> {
    const b = body as { storyVideoJobId?: unknown; trailerBreakdownJobId?: unknown };
    return {
      storyVideoJobId:
        typeof b.storyVideoJobId === 'string' ? b.storyVideoJobId : undefined,
      trailerBreakdownJobId:
        typeof b.trailerBreakdownJobId === 'string' ? b.trailerBreakdownJobId : undefined,
    };
  }

  router.post('/all', async (req: Request, res: Response) => {
    try {
      const response = await uploadToPlatforms(
        { platforms: ['youtube', 'instagram'], userId: req.user?.id, ...uploadIdsFromBody(req.body) },
        envConfig
      );

      if (response.success) {
        return res.status(200).json(response);
      }
      const ytErr = response.platforms?.youtube?.error;
      const { status, hint } = classifyYouTubeFailure(response.errors || [], ytErr);
      const error = (response.errors && response.errors[0]) || ytErr || 'Upload failed';
      return res.status(status).json({ ...response, error, hint });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { status, hint } = classifyYouTubeFailure([errorMessage]);
      return res.status(status).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        error: errorMessage,
        hint,
      });
    }
  });

  router.post('/youtube', async (req: Request, res: Response) => {
    try {
      const response = await uploadToPlatforms(
        { platforms: ['youtube'], userId: req.user?.id, ...uploadIdsFromBody(req.body) },
        envConfig
      );

      if (response.success) {
        return res.status(200).json(response);
      }
      const ytErr = response.platforms?.youtube?.error;
      const { status, hint } = classifyYouTubeFailure(response.errors || [], ytErr);
      const error = (response.errors && response.errors[0]) || ytErr || 'YouTube upload failed';
      return res.status(status).json({ ...response, error, hint });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { status, hint } = classifyYouTubeFailure([errorMessage]);
      return res.status(status).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        error: errorMessage,
        hint,
      });
    }
  });

  router.post('/instagram', async (req: Request, res: Response) => {
    try {
      const response = await uploadToPlatforms(
        { platforms: ['instagram'], userId: req.user?.id, ...uploadIdsFromBody(req.body) },
        envConfig
      );

      if (response.success) {
        return res.status(200).json(response);
      }
      const { status, hint } = classifyInstagramFailure(response.errors || []);
      return res.status(status).json({ ...response, hint });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        platforms: {},
        errors: [errorMessage],
        hint:
          'Unexpected server error while uploading to Instagram. Check server logs for the Python output and try again.',
      });
    }
  });

  return router;
}

// Backward-compatible alias while normalizing route factory naming.
export const createUploadsRoutes = createUploadRoutes;

export async function uploadToYoutubeController(envConfig: EnvConfig): Promise<UploadControllerResponse> {
  return uploadToPlatforms({ platforms: ['youtube'] }, envConfig);
}

export async function uploadToInstagramController(envConfig: EnvConfig): Promise<UploadControllerResponse> {
  return uploadToPlatforms({ platforms: ['instagram'] }, envConfig);
}

export async function uploadToAllController(envConfig: EnvConfig): Promise<UploadControllerResponse> {
  return uploadToPlatforms({ platforms: ['youtube', 'instagram'] }, envConfig);
}
