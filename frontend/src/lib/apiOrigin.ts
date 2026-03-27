/**
 * When the UI is hosted separately from the API, set VITE_API_ORIGIN at build time.
 */

export function getApiOrigin(): string {
  const v = typeof import.meta.env.VITE_API_ORIGIN === 'string' ? import.meta.env.VITE_API_ORIGIN.trim() : '';
  return v ? v.replace(/\/$/, '') : '';
}

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  const o = getApiOrigin();
  return o ? `${o}${p}` : p;
}

export function resolvePlayMediaUrl(urlFromApi: string): string {
  if (!urlFromApi.startsWith('/')) return urlFromApi;
  const o = getApiOrigin();
  if (o) return `${o}${urlFromApi}`;
  if (import.meta.env.DEV) return `http://localhost:3000${urlFromApi}`;
  return urlFromApi;
}
