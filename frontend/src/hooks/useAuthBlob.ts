import { useState, useEffect, useRef } from 'react';

export function authFetch(url: string): Promise<Response> {
  const token = localStorage.getItem('token');
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

export function useAuthBlobUrl(url: string | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let revoked = false;
    authFetch(url)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (revoked || !blob) return;
        const u = URL.createObjectURL(blob);
        prev.current = u;
        setBlobUrl(u);
      });
    return () => {
      revoked = true;
      if (prev.current) URL.revokeObjectURL(prev.current);
    };
  }, [url]);

  return blobUrl;
}
