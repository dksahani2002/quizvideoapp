/**
 * Adapter Service - TTS (Text-to-Speech)
 * Adapts existing TTS implementation to domain interface
 */

import { TTSService } from '../../services/ttsService.js';
import { SystemTTS } from '../../services/ttsService.js';

export class AdaptedTTSService implements TTSService {
  private ttsService: SystemTTS;

  constructor() {
    // Use system TTS with default config
    this.ttsService = new SystemTTS('./cache/tts');
  }

  async generate(text: string, language: string, voice?: string): Promise<string> {
    return this.ttsService.generate(text, language, voice);
  }
}
