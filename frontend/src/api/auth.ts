import { useMutation } from '@tanstack/react-query';
import { api } from './client';

interface AuthResponse {
  success: boolean;
  data: {
    token: string;
    user: { id: string; name: string; email: string; role?: 'user' | 'admin' };
  };
}

export function useLogin() {
  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      api.post<AuthResponse>('/api/auth/login', data),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (data: { name: string; email: string; password: string }) =>
      api.post<AuthResponse>('/api/auth/register', data),
  });
}
