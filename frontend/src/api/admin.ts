import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AuditRow {
  id: string;
  userId: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  userAgent: string;
  error: string;
  createdAt: string;
  meta: unknown;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<{ success: boolean; data: AdminUserRow[] }>('/api/admin/users').then(r => r.data),
  });
}

export function useAuditLog(params: { userId?: string; action?: string; limit?: number; cursor?: string }) {
  const qs = new URLSearchParams();
  if (params.userId) qs.set('userId', params.userId);
  if (params.action) qs.set('action', params.action);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const url = `/api/admin/audit?${qs.toString()}`;
  return useQuery({
    queryKey: ['admin', 'audit', url],
    queryFn: () => api.get<{ success: boolean; data: { items: AuditRow[]; nextCursor: string | null } }>(url).then(r => r.data),
    refetchInterval: 5000,
  });
}

