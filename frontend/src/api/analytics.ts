import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface AnalyticsSummary {
  total: number;
  published: number;
  failed: number;
  byPlatform: Record<string, number>;
  recent: Array<{
    id: string;
    platform: string;
    status: string;
    scheduledAt: string;
    createdAt: string;
    lastError: string;
    result: unknown;
  }>;
}

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => api.get<{ success: boolean; data: AnalyticsSummary }>('/api/analytics/summary').then(r => r.data),
    refetchInterval: 10000,
  });
}

export function useRefreshYouTubeMetrics() {
  return useMutation({
    mutationFn: () => api.post('/api/analytics/youtube/refresh', {}),
  });
}

