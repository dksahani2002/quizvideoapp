import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AppSettings } from '../types';

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ success: boolean; data: AppSettings }>('/api/settings').then(r => r.data),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: DeepPartial<AppSettings>) =>
      api.put<{ success: boolean; data: AppSettings }>('/api/settings', settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
