import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { VideoItem, GenerateRequest } from '../types';

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
      api.post<{ success: boolean; jobId: string; status: string; quizCount: number }>('/api/videos/generate', req),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['videos'] }), 3000);
    },
  });
}

export function useUpload(platform: 'youtube' | 'instagram' | 'all') {
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; platforms: unknown; errors: string[] }>(`/api/uploads/${platform}`, {}),
  });
}

export function useDeleteVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ success: boolean }>(`/api/videos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos'] }),
  });
}
