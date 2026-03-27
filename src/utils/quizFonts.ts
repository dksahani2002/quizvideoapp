/**
 * FFmpeg drawtext uses a single font file; Montserrat only covers Latin.
 * For non-Latin scripts, use optional Noto fonts in assets/fonts (see scripts/download-noto-fonts.sh).
 */
import fs from 'fs';
import path from 'path';

const fontsDir = () => path.join(process.cwd(), 'assets', 'fonts');

/** Primary font per ISO 639-1 base code (files must exist after running download script). */
const LANGUAGE_FONT_FILE: Record<string, string> = {
  hi: 'NotoSansDevanagari-Bold.ttf',
  mr: 'NotoSansDevanagari-Bold.ttf',
  ne: 'NotoSansDevanagari-Bold.ttf',
  bn: 'NotoSansBengali-Bold.ttf',
  ta: 'NotoSansTamil-Bold.ttf',
  te: 'NotoSansTelugu-Bold.ttf',
  gu: 'NotoSansGujarati-Bold.ttf',
  kn: 'NotoSansKannada-Bold.ttf',
  ml: 'NotoSansMalayalam-Bold.ttf',
  pa: 'NotoSansGurmukhi-Bold.ttf',
  ar: 'NotoSansArabic-Bold.ttf',
  th: 'NotoSansThai-Bold.ttf',
  zh: 'NotoSansCJKsc-Bold.otf',
  ja: 'NotoSansCJKjp-Bold.otf',
  ko: 'NotoSansCJKkr-Bold.otf',
  ru: 'NotoSans-Bold.ttf',
  uk: 'NotoSans-Bold.ttf',
  bg: 'NotoSans-Bold.ttf',
  el: 'NotoSans-Bold.ttf',
};

/**
 * Pick a font file that can render quiz text for the given language.
 * Falls back to `fallbackFontPath` (typically Montserrat) when no bundled Noto file exists.
 */
export function resolveFontFileForLanguage(language: string | undefined, fallbackFontPath: string): string {
  const fallback = path.resolve(fallbackFontPath);
  const base = (language || 'en').split('-')[0].toLowerCase();
  if (base === 'en') return fallback;

  const fileName = LANGUAGE_FONT_FILE[base];
  if (!fileName) return fallback;

  const candidate = path.join(fontsDir(), fileName);
  if (fs.existsSync(candidate)) return candidate;

  console.warn(
    `[quizFonts] Missing "${fileName}" for language "${base}" (quiz text may show boxes). ` +
      `Run: bash scripts/download-noto-fonts.sh`
  );
  return fallback;
}
