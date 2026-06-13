/**
 * Client idempotency key normalization for story job creation.
 *
 * Used by storyVideoRoutes POST /create to dedupe retries (header or body field).
 * Max 128 chars; empty → no idempotency.
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!s) return null;
  return s.slice(0, 128);
}
