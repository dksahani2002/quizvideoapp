/**
 * Text-to-Speech Service Interface
 * Abstraction for audio generation
 */

export interface ITTSService {
  /**
   * Generate audio for text
   */
  generateAudio(text: string, language: string): Promise<string>;

  /**
   * Get cached audio if available
   */
  getCachedAudio(text: string, language: string): Promise<string | null>;
}
