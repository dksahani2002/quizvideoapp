import { useQuery } from '@tanstack/react-query';
import { apiUrlWithTokenForMedia } from '../../lib/mediaUrl';
import { api } from '../../api/client';

export type StoryClipCropNorm = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type StoryClip = {
  id: string;
  start: number;
  end: number;
  text: string;
  narrationIndex?: number;
  sceneIndex?: number;
  videoUrl?: string;
  trimStart?: number;
  trimEnd?: number;
  /** Override: where to start reading picture from the original upload (seconds). */
  sourceInSec?: number;
  /** Seconds of source to use; if longer than the clip slot, video is trimmed from the start to the slot length. */
  sourceTakeSec?: number;
  /** Normalized crop on source frame (0–1). Omitted = full frame. */
  cropNorm?: StoryClipCropNorm;
  /** Program/export length (s). When set, timeline slot follows narration; video pads if shorter than voice. */
  programDurationSec?: number;
  overlayImageUrl?: string;
  /** Full-frame image replaces the clip video (export + preview). */
  overlayImageOverridesClip?: boolean;
  overlayText?: string;
  overlayPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlayOpacity?: number;
};

export type StoryEditorImageAsset = {
  id: string;
  url: string;
  name: string;
};

export type StoryTimeline = { clips: StoryClip[]; imageLibrary?: StoryEditorImageAsset[] };

export type StoryJobOptions = {
  sceneDetectionMode: 'ffmpeg' | 'pyscenedetect' | 'hybrid';
  subtitleMode: 'none' | 'burn_in' | 'sidecar_srt' | 'both';
  bgmVolume: number;
  exportPreset: 'fast' | 'balanced' | 'quality';
  narrationLanguage: string;
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs';
  pySceneThreshold: number;
  ffmpegSceneThreshold: number;
  /** `sequential` when narration language differs from video dialogue (e.g. Hindi VO on Korean clip). */
  narrationSceneMatchMode: 'embeddings' | 'sequential';
  /** Normalize scene + narration text to English in the editor and exports. */
  translateToEnglish: boolean;
};

export type SceneInfo = {
  index: number;
  start: number;
  end: number;
  text: string;
  /** Original line before English translation (when translate ran). */
  textOriginal?: string;
};

export async function createStoryVideoJob(formData: FormData, idempotencyKey?: string) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch('/api/story-video/create', {
    method: 'POST',
    body: formData,
    headers,
  });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<{
    success: boolean;
    data: {
      jobId: string;
      status: string;
      options: StoryJobOptions;
      idempotentReplay?: boolean;
    };
  }>;
}

export async function presignStoryMediaUpload(body: {
  kind: 'video' | 'audio' | 'bgm' | 'image';
  filename?: string;
  contentType?: string;
}) {
  return api.post<{
    success: boolean;
    data: {
      putUrl: string;
      getUrl: string;
      bucket: string;
      key: string;
      contentType: string;
      expiresIn: number;
    };
  }>('/api/story-video/presign-upload', body);
}

/**
 * Presigned S3 PUT when buckets are configured; otherwise POST multipart to `/upload-user-media` (disk cache).
 */
export async function uploadStoryAssetWithPresignOrLocal(
  file: File,
  body: { kind: 'video' | 'audio' | 'bgm' | 'image'; filename?: string; contentType?: string }
): Promise<{ getUrl: string; contentType: string }> {
  const token = localStorage.getItem('token');
  const presRes = await fetch('/api/story-video/presign-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      ...body,
      filename: body.filename ?? file.name,
      contentType: body.contentType || file.type || undefined,
    }),
  });

  if (presRes.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const presJson = (await presRes.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { putUrl: string; getUrl: string; contentType: string };
    error?: string;
  };

  if (presRes.ok && presJson.success && presJson.data?.putUrl && presJson.data?.getUrl) {
    const d = presJson.data;
    const up = await fetch(d.putUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': d.contentType },
    });
    if (!up.ok) throw new Error(`Upload failed: ${up.status}`);
    return { getUrl: d.getUrl, contentType: d.contentType };
  }

  if (presRes.status === 503) {
    const fd = new FormData();
    fd.append('kind', body.kind);
    fd.append('file', file);
    const upRes = await fetch('/api/story-video/upload-user-media', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (upRes.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    const upJson = (await upRes.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { path: string; contentType: string };
      error?: string;
    };
    if (!upRes.ok || !upJson.success || !upJson.data?.path) {
      throw new Error(upJson.error || `Local upload failed: ${upRes.status}`);
    }
    return {
      getUrl: apiUrlWithTokenForMedia(upJson.data.path),
      contentType: upJson.data.contentType,
    };
  }

  throw new Error(presJson.error || `Upload failed: ${presRes.status}`);
}

export async function cancelStoryVideoJob(jobId: string) {
  return api.post<{ success: boolean }>(`/api/story-video/${jobId}/cancel`, {});
}

export async function retryStoryVideoJob(jobId: string) {
  return api.post<{ success: boolean }>(`/api/story-video/${jobId}/retry`, {});
}

export async function getStoryVideoStatus(jobId: string) {
  return api.get<{
    success: boolean;
    data: {
      jobId: string;
      status: string;
      stage: string;
      progressMessage: string;
      progressPercent: number;
      cancelRequested: boolean;
      error: string;
      attempts: number;
      maxAttempts: number;
      createdAt: string;
      updatedAt: string;
    };
  }>(`/api/story-video/${jobId}/status`);
}

export async function getStoryVideoResult(jobId: string) {
  return api.get<{
    success: boolean;
    data: {
      jobId: string;
      status: string;
      timeline: StoryTimeline;
      outputVideoUrl: string;
      outputSrtUrl: string;
      scenes: SceneInfo[];
      options: StoryJobOptions;
      error: string;
      detectedLanguages?: { video?: string; narration?: string };
    };
  }>(`/api/story-video/${jobId}/result`);
}

export async function editStoryVideo(
  jobId: string,
  body: { timeline?: StoryTimeline; render?: boolean }
) {
  return api.post<{
    success: boolean;
    data: {
      timeline: StoryTimeline;
      outputVideoUrl: string;
      outputSrtUrl: string;
      /** Re-render runs in the background; poll status until completed */
      asyncRerender?: boolean;
      status?: string;
    };
  }>(`/api/story-video/${jobId}/edit`, body);
}

export function getStorySubtitlesDownloadUrl(jobId: string): string {
  return `/api/story-video/${jobId}/subtitles.srt`;
}

export type StoryVideoJobListItem = {
  jobId: string;
  status: string;
  stage: string;
  progressMessage: string;
  progressPercent: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  scriptPreview: string;
};

export function useStoryVideoJobs() {
  return useQuery({
    queryKey: ['story-video-jobs'],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: StoryVideoJobListItem[] }>('/api/story-video/jobs');
      return r.data;
    },
    refetchInterval: 5000,
  });
}
