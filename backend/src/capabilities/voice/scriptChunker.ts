export const MAX_TTS_CHUNK = 3800;

/**
 * Chunk long scripts by paragraph / size for TTS API limits.
 */
export function chunkScriptForTts(script: string): string[] {
  const trimmed = script.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n\n' + p).length > MAX_TTS_CHUNK && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  if (chunks.length === 0) return [trimmed];
  return chunks;
}
