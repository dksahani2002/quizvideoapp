import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { VideoItem, GenerateRequest } from '../types';

export interface PreviewTopicRequest {
  topic: string;
  language: string;
  translateTopic: boolean;
  enhanceTopic: boolean;
  openaiModel?: string;
}

export interface PreviewTopicResult {
  localizedLabel: string;
  promptSubject: string;
}

export function previewTopic(req: PreviewTopicRequest) {
  return api.post<{ success: boolean; data: PreviewTopicResult }>('/api/videos/preview-topic', req);
}

export function useVideos() {
  return useQuery({
    queryKey: ['videos'],
    queryFn: () => api.get<{ success: boolean; data: VideoItem[] }>('/api/videos').then(r => r.data),
    refetchInterval: 5000,
  });
}

export function useGenerateVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) =>
      api.post<{ success: boolean; data: Array<{ jobId: string; videoId: string; status: string; topic: string }> }>('/api/videos/generate', req),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['videos'] }), 3000);
    },
  });
}

export type UploadJobSource =
  | { storyVideoJobId: string }
  | { trailerBreakdownJobId: string };

export function useUpload(
  platform: 'youtube' | 'instagram' | 'all',
  /** Publish a specific story-video or trailer-breakdown job output. */
  source?: UploadJobSource | string | null
) {
  return useMutation({
    mutationFn: () => {
      let body: Record<string, string> = {};
      if (typeof source === 'string' && source) {
        body = { storyVideoJobId: source };
      } else if (source && typeof source === 'object') {
        if ('trailerBreakdownJobId' in source && source.trailerBreakdownJobId) {
          body = { trailerBreakdownJobId: source.trailerBreakdownJobId };
        } else if ('storyVideoJobId' in source && source.storyVideoJobId) {
          body = { storyVideoJobId: source.storyVideoJobId };
        }
      }
      return api.post<{ success: boolean; platforms: unknown; errors: string[]; hint?: string }>(
        `/api/uploads/${platform}`,
        body
      );
    },
  });
}

export function useDeleteVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ success: boolean }>(`/api/videos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos'] }),
  });
}
