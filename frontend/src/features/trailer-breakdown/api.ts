import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export type TrailerJobOptions = {
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs' | 'system';
  ttsVoice: string;
  ttsModel: 'tts-1' | 'tts-1-hd' | string;
  systemVoice: string;
  elevenlabsModelId: string;
  narrationLanguage: string;
  exportPreset: 'fast' | 'balanced' | 'quality';
  sceneDetectionMode: 'ffmpeg' | 'pyscenedetect' | 'hybrid';
  ffmpegSceneThreshold: number;
};

export type BreakdownSegment = {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  narration: string;
  onScreenText?: string;
};

export type TrailerJobListItem = {
  jobId: string;
  status: string;
  stage: string;
  progressMessage: string;
  progressPercent: number;
  error: string;
  youtubeUrl: string;
  movieTitle: string;
  scriptPreview: string;
  createdAt: string;
  updatedAt: string;
};

export type TrailerJobResult = {
  jobId: string;
  status: string;
  breakdownTitle: string;
  movieTitle: string;
  youtubeUrl: string;
  breakdownScript: BreakdownSegment[];
  outputVideoUrl: string;
  options?: TrailerJobOptions;
};

export async function createTrailerBreakdownJob(body: {
  youtubeUrl: string;
  movieTitle?: string;
  options?: TrailerJobOptions;
}) {
  return api.post<{ success: boolean; data: { jobId: string; status: string } }>(
    '/api/trailer-breakdown/create',
    body
  );
}

export async function fetchTrailerJobs(): Promise<TrailerJobListItem[]> {
  const res = await api.get<{ success: boolean; data: TrailerJobListItem[] }>(
    '/api/trailer-breakdown/jobs'
  );
  return res.data ?? [];
}

export async function fetchTrailerJobStatus(jobId: string) {
  const res = await api.get<{
    success: boolean;
    data: {
      status: string;
      stage: string;
      progressMessage: string;
      progressPercent: number;
      error: string;
    };
  }>(`/api/trailer-breakdown/${jobId}/status`);
  return res.data;
}

export async function fetchTrailerJobResult(jobId: string) {
  const res = await api.get<{ success: boolean; data: TrailerJobResult }>(
    `/api/trailer-breakdown/${jobId}/result`
  );
  return res.data;
}

export async function patchTrailerScript(
  jobId: string,
  breakdownScript: BreakdownSegment[],
  breakdownTitle?: string
) {
  return api.patch<{ success: boolean; data: { breakdownScript: BreakdownSegment[] } }>(
    `/api/trailer-breakdown/${jobId}/script`,
    { breakdownScript, breakdownTitle }
  );
}

export async function patchTrailerOptions(jobId: string, options: TrailerJobOptions) {
  return api.patch<{ success: boolean; data: { options: TrailerJobOptions } }>(
    `/api/trailer-breakdown/${jobId}/options`,
    { options }
  );
}

export async function renderTrailerJob(jobId: string) {
  return api.post<{ success: boolean; data: { jobId: string; status: string } }>(
    `/api/trailer-breakdown/${jobId}/render`,
    {}
  );
}

export async function cancelTrailerJob(jobId: string) {
  return api.post<{ success: boolean }>(`/api/trailer-breakdown/${jobId}/cancel`, {});
}

export async function retryTrailerJob(jobId: string) {
  return api.post<{ success: boolean; data: { jobId: string; status: string } }>(
    `/api/trailer-breakdown/${jobId}/retry`,
    {}
  );
}

export function useTrailerJobs() {
  return useQuery({
    queryKey: ['trailer-breakdown-jobs'],
    queryFn: fetchTrailerJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs?.some((j: TrailerJobListItem) => j.status === 'pending' || j.status === 'processing')) {
        return false;
      }
      return 4000;
    },
  });
}

export function useTrailerJobStatus(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['trailer-breakdown-status', jobId],
    queryFn: () => fetchTrailerJobStatus(jobId!),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'pending' || s === 'processing') return 3000;
      return false;
    },
  });
}

export function useTrailerJobResult(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['trailer-breakdown-result', jobId],
    queryFn: () => fetchTrailerJobResult(jobId!),
    enabled: enabled && !!jobId,
  });
}
