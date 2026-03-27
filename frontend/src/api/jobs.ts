import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobDetails {
  id: string;
  videoId: string;
  status: JobStatus;
  attempts: number;
  cancelRequested: boolean;
  stage: string;
  message: string;
  events: Array<{ at: string; stage: string; message: string }>;
  createdAt: string;
  updatedAt: string;
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<{ success: boolean; data: JobDetails }>(`/api/jobs/${jobId}`).then(r => r.data),
    enabled: !!jobId,
    refetchInterval: 3000,
  });
}

export function useCancelJob(jobId: string) {
  return useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/cancel`, {}),
  });
}

export function useRetryJob(jobId: string) {
  return useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/retry`, {}),
  });
}

