/**
 * Extract the first JSON array from AI output (strips markdown code fences).
 */
export function extractJsonArray(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('AI response is empty or not a string');
  }

  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');

  if (start === -1 || end === -1) {
    throw new Error('No JSON array found in AI response');
  }

  return cleaned.slice(start, end + 1);
}
