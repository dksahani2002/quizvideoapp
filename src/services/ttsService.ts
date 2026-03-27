/**
 * Text-to-Speech service
 * Supports multiple providers with caching
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TTSService {
  generate(text: string, language: string, voice?: string): Promise<string>;
}

/**
 * Generate hash for TTS caching
 */
function generateTTSHash(text: string, language: string, voice?: string): string {
  const content = `${text}|${language}|${voice || 'default'}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * OpenAI TTS service
 */
export class OpenAITTS implements TTSService {
  private apiKey: string;
  private model: string;
  private cacheDir: string;
  private speechUrl: string;

  constructor(apiKey: string, model: string = 'tts-1', cacheDir: string, openaiBaseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.cacheDir = cacheDir;
    const base = (openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.speechUrl = `${base}/audio/speech`;
  }
  
  async generate(text: string, language: string, voice?: string): Promise<string> {
    const hash = generateTTSHash(text, language, voice);
    const cacheFile = path.join(this.cacheDir, `${hash}.mp3`);
    
    // Check cache
    try {
      await fs.access(cacheFile);
      return cacheFile;
    } catch {
      // Not cached, generate
    }
    
    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Call OpenAI TTS API
    const selectedVoice = voice || (language.startsWith('en') ? 'alloy' : 'nova');
    
    try {
      const response = await fetch(this.speechUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: selectedVoice,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI TTS API error: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(cacheFile, buffer);
      
      return cacheFile;
    } catch (error: any) {
      throw new Error(`TTS generation failed: ${error.message}`);
    }
  }
}

/**
 * System TTS (macOS say command, Linux espeak, etc.)
 * Fallback option
 */
export class SystemTTS implements TTSService {
  private cacheDir: string;
  
  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }
  
  async generate(text: string, language: string, voice?: string): Promise<string> {
    if (process.platform !== 'darwin') {
      throw new Error(
        'System TTS is only supported on macOS (uses `say`). On AWS Lambda, use OpenAI or ElevenLabs TTS instead.'
      );
    }
    const hash = generateTTSHash(text, language, voice);
    const cacheFile = path.join(this.cacheDir, `${hash}.mp3`);
    
    // Check cache
    try {
      await fs.access(cacheFile);
      return cacheFile;
    } catch {
      // Not cached, generate
    }
    
    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Create absolute paths
    const absoluteCacheFile = path.resolve(cacheFile);
    const tempWav = absoluteCacheFile.replace('.mp3', '.wav');
    
    try {
      // Create temp file first
      await fs.writeFile(tempWav, '');
      
      // macOS say command with m4a output (more reliable)
      const tempM4a = absoluteCacheFile.replace('.mp3', '.m4a');
      const escapedText = text.replace(/"/g, '\\"');
      
      // Use say with -o and let it auto-detect format
      await execAsync(`say -v ${voice || 'Alex'} -o "${tempM4a}" "${escapedText}"`);
      
      // Convert to MP3 using absolute path
      await execAsync(`ffmpeg -i "${tempM4a}" -ar 44100 -ac 2 -codec:a libmp3lame -q:a 4 -y "${absoluteCacheFile}" 2>/dev/null`);
      
      // Clean up temp files
      await fs.unlink(tempM4a).catch(() => {});
      await fs.unlink(tempWav).catch(() => {});
      
      return absoluteCacheFile;
    } catch (error: any) {
      // Clean up on error
      await fs.unlink(tempWav).catch(() => {});
      throw new Error(`System TTS failed: ${error.message}`);
    }
  }
}

/**
 * ElevenLabs TTS service
 */
export class ElevenLabsTTS implements TTSService {
  private apiKey: string;
  private cacheDir: string;
  private modelId: string;

  constructor(apiKey: string, cacheDir: string, modelId: string = 'eleven_turbo_v2_5') {
    this.apiKey = apiKey;
    this.cacheDir = cacheDir;
    this.modelId = modelId;
  }

  async generate(text: string, language: string, voice?: string): Promise<string> {
    const hash = generateTTSHash(text, language, `elevenlabs-${voice}`);
    const cacheFile = path.join(this.cacheDir, `${hash}.mp3`);

    try {
      await fs.access(cacheFile);
      return cacheFile;
    } catch {
      // Not cached
    }

    await fs.mkdir(this.cacheDir, { recursive: true });

    const voiceId = voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel default

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs TTS error ${response.status}: ${body}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(cacheFile, Buffer.from(arrayBuffer));
    return cacheFile;
  }
}

/**
 * Fetch available voices from ElevenLabs
 */
export async function fetchElevenLabsVoices(apiKey: string): Promise<Array<{ voice_id: string; name: string; category: string }>> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch voices (${response.status}): ${body || response.statusText}`);
  }
  const data = await response.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
  return data.voices.map(v => ({ voice_id: v.voice_id, name: v.name, category: v.category }));
}

/**
 * Create TTS service based on provider
 */
export function createTTSService(
  provider: 'openai' | 'system' | 'elevenlabs',
  config: {
    apiKey?: string;
    model?: string;
    cacheDir: string;
    elevenlabsApiKey?: string;
    elevenlabsModelId?: string;
    openaiApiUrl?: string;
  }
): TTSService {
  if (provider === 'openai') {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required for OpenAI TTS');
    }
    return new OpenAITTS(config.apiKey, config.model, config.cacheDir, config.openaiApiUrl);
  } else if (provider === 'elevenlabs') {
    if (!config.elevenlabsApiKey) {
      throw new Error('ElevenLabs API key required');
    }
    return new ElevenLabsTTS(config.elevenlabsApiKey, config.cacheDir, config.elevenlabsModelId || 'eleven_turbo_v2_5');
  } else {
    return new SystemTTS(config.cacheDir);
  }
}
