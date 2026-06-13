import OpenAI from 'openai';

/**
 * Batch-embed short text lines for narration↔scene similarity matching.
 *
 * Truncates each line to 8k chars and sends up to 64 inputs per API call.
 */
export async function embedTexts(
  client: OpenAI,
  texts: string[],
  model = 'text-embedding-3-small'
): Promise<number[][]> {
  const cleaned = texts.map((t) => (t && t.trim() ? t.trim().slice(0, 8000) : ' '));
  const out: number[][] = [];
  const batchSize = 64;
  for (let i = 0; i < cleaned.length; i += batchSize) {
    const batch = cleaned.slice(i, i + batchSize);
    const res = await client.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const d of sorted) out.push(d.embedding);
  }
  return out;
}

/** Cosine similarity between two embedding vectors (0–1 scale; higher = more similar). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}
