/**
 * Text sanitization utilities for quiz video rendering
 * Handles FFmpeg escaping, emoji removal, line wrapping, and special characters
 */

import { Quiz } from '../types/index.js';

/**
 * Remove emojis from text (for TTS input)
 * TTS APIs may not handle emojis well
 */
export function removeEmojis(text: string): string {
  // Remove emoji and other symbols that might break TTS
  return text.replace(
    /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
    ''
  ).trim();
}

/**
 * Escape FFmpeg drawtext special characters
 * FFmpeg drawtext requires escaping: \, :, ', and "
 */
export function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/:/g, '\\:')     // Escape colons
    .replace(/'/g, "\\'")     // Escape single quotes
    .replace(/"/g, '\\"')     // Escape double quotes
    .replace(/%/g, '\\%')     // Escape percent signs
    .replace(/\n/g, '\\n')    // Preserve newlines as literal
    .replace(/\r/g, '');      // Remove carriage returns
}

/**
 * Wrap text to max line length, preserving word boundaries
 */
export function wrapText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }
  
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxLength) {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      // If single word exceeds maxLength, split it
      if (word.length > maxLength) {
        // Split long word
        let remaining = word;
        while (remaining.length > maxLength) {
          lines.push(remaining.substring(0, maxLength));
          remaining = remaining.substring(maxLength);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Sanitize quiz text for TTS (remove emojis, normalize)
 */
export function sanitizeForTTS(text: string): string {
  return removeEmojis(text)
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Sanitize quiz text for FFmpeg drawtext (escape special chars)
 */
export function sanitizeForFFmpeg(text: string): string {
  return escapeFFmpegText(text);
}

/**
 * Validate quiz structure
 */
export function validateQuiz(quiz: Quiz): { valid: boolean; error?: string } {
  if (!quiz.question || typeof quiz.question !== 'string') {
    return { valid: false, error: 'Question must be a non-empty string' };
  }
  
  if (!Array.isArray(quiz.options) || quiz.options.length !== 4) {
    return { valid: false, error: 'Options must be an array of exactly 4 strings' };
  }
  
  for (let i = 0; i < quiz.options.length; i++) {
    if (typeof quiz.options[i] !== 'string' || !quiz.options[i].trim()) {
      return { valid: false, error: `Option ${i} must be a non-empty string` };
    }
  }
  
  if (
    typeof quiz.answerIndex !== 'number' ||
    quiz.answerIndex < 0 ||
    quiz.answerIndex >= 4 ||
    !Number.isInteger(quiz.answerIndex)
  ) {
    return { valid: false, error: 'answerIndex must be 0, 1, 2, or 3' };
  }
  
  // Validate language code if provided
  if (quiz.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(quiz.language)) {
    return { valid: false, error: 'Language must be a valid ISO 639-1 code (e.g., "en", "en-US")' };
  }
  
  return { valid: true };
}

/**
 * Normalize quiz data (sanitize text, set defaults)
 */
export function normalizeQuiz(quiz: Quiz): Quiz {
  return {
    question: sanitizeForTTS(quiz.question),
    options: quiz.options.map(opt => sanitizeForTTS(opt)) as [string, string, string, string],
    answerIndex: quiz.answerIndex,
    language: quiz.language || 'en',
  };
}

/**
 * Generate countdown text (e.g., "3... 2... 1...")
 */
export function generateCountdownText(language: string = 'en'): string {
  const countdowns: Record<string, string> = {
    en: '3... 2... 1...',
    es: '3... 2... 1...',
    fr: '3... 2... 1...',
    de: '3... 2... 1...',
  };
  
  return countdowns[language] || countdowns.en;
}
