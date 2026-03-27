/**
 * Normalize quiz language from API (ISO 639-1 or BCP 47 like en-US).
 * Falls back to `en` if invalid.
 */
export function normalizeQuizLanguage(input: unknown): string {
  if (typeof input !== 'string') return 'en';
  const s = input.trim();
  if (!s) return 'en';
  if (/^[a-z]{2}$/i.test(s)) return s.toLowerCase();
  const m = /^([a-z]{2})-([A-Za-z]{2})$/i.exec(s);
  if (m) return `${m[1].toLowerCase()}-${m[2].toUpperCase()}`;
  return 'en';
}

/** Human-readable name for AI prompts (topic mode). */
const DISPLAY: Record<string, string> = {
  en: 'English',
  hi: 'Hindi (Devanagari)',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  ar: 'Arabic',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese (Simplified)',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
};

export function quizLanguageDisplayName(code: string | undefined): string {
  if (!code || typeof code !== 'string') return DISPLAY.en;
  const base = code.split('-')[0].toLowerCase();
  return DISPLAY[base] || code;
}
