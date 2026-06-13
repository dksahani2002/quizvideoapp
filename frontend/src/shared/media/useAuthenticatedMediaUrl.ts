import { useEffect, useState } from 'react';
import { authFetch } from '../../hooks/useAuthBlob';
import { apiUrlWithTokenForMedia } from '../../lib/mediaUrl';

function resolvePlayUrl(raw: string): string {
  if (import.meta.env.DEV && raw.startsWith('/')) {
    const apiOrigin =
      (typeof import.meta.env.VITE_API_ORIGIN === 'string' && import.meta.env.VITE_API_ORIGIN.trim()) ||
      'http://127.0.0.1:3000';
    return apiUrlWithTokenForMedia(`${apiOrigin.replace(/\/$/, '')}${raw}`);
  }
  return raw.startsWith('/api/') ? apiUrlWithTokenForMedia(raw) : raw;
}

export function useAuthenticatedMediaUrl(playEndpoint: string | null | undefined, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !playEndpoint) return;
    if (url) return;

    setLoading(true);
    setError(null);
    authFetch(playEndpoint)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error('play'))))
      .then((j: { success?: boolean; url?: string }) => {
        const raw = typeof j?.url === 'string' ? j.url : null;
        if (!raw) {
          setUrl(null);
          return;
        }
        setUrl(resolvePlayUrl(raw));
      })
      .catch((e) => {
        setUrl(null);
        setError(e instanceof Error ? e.message : 'Failed to load media');
      })
      .finally(() => setLoading(false));
  }, [enabled, playEndpoint, url]);

  return { url, loading, error };
}
