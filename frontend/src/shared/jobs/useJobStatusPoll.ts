import { useQuery } from '@tanstack/react-query';
import type { JobStatusShape } from './types';

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'processing']);

export function useJobStatusPoll<T extends JobStatusShape>(
  queryKey: unknown[],
  queryFn: () => Promise<T[]>,
  options?: { intervalMs?: number; activeStatuses?: string[] }
) {
  const intervalMs = options?.intervalMs ?? 5000;
  const activeStatuses = options?.activeStatuses ?? Array.from(ACTIVE_STATUSES);

  return useQuery({
    queryKey,
    queryFn,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      return jobs.some((j) => activeStatuses.includes(j.status)) ? intervalMs : false;
    },
  });
}
