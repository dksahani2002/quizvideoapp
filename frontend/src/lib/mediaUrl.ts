function pathnameStartsWithApi(url: string): boolean {
  try {
    if (url.startsWith('/')) return url.split('?')[0].startsWith('/api/');
    return new URL(url).pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Browser <video> / window.open cannot send Authorization; API accepts GET ?token= with the same JWT.
 */
export function apiUrlWithTokenForMedia(url: string, cacheBust?: number): string {
  let u = url;
  if (cacheBust != null && cacheBust > 0) {
    u += `${u.includes('?') ? '&' : '?'}_cb=${cacheBust}`;
  }
  if (!pathnameStartsWithApi(u)) return u;
  const token = localStorage.getItem('token');
  if (!token) return u;
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}token=${encodeURIComponent(token)}`;
}
