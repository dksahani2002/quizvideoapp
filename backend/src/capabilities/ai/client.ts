import OpenAI from 'openai';

/**
 * Build an OpenAI SDK client from app Settings credentials.
 *
 * Use at the start of a story job; baseUrl is trimmed of trailing slashes for proxy/custom endpoints.
 */
export function createOpenAIClient(apiKey: string, baseUrl: string): OpenAI {
  const base = baseUrl.replace(/\/$/, '');
  return new OpenAI({ apiKey, baseURL: base });
}
