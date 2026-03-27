import type { GenerateRequest } from '../types';

export type TtsPreviewParams = Pick<
  GenerateRequest,
  'ttsProvider' | 'ttsVoice' | 'ttsModel' | 'systemVoice' | 'elevenlabsModelId'
> & { text?: string };

export async function previewTts(params: TtsPreviewParams): Promise<Blob> {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/tts/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Preview failed (${res.status})`);
  }

  return res.blob();
}
