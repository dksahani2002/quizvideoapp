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

async function isValidAudioFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.size || stat.size < 1000) return false;
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const dur = parseFloat((stdout || '').trim());
    return Number.isFinite(dur) && dur > 0;
  } catch {
    return false;
  }
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
      if (await isValidAudioFile(cacheFile)) return cacheFile;
      // Corrupt/partial cache entry; remove and regenerate.
      await fs.unlink(cacheFile).catch(() => {});
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
      if (!(await isValidAudioFile(cacheFile))) {
        await fs.unlink(cacheFile).catch(() => {});
        throw new Error('OpenAI returned invalid audio payload');
      }
      
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
      if (await isValidAudioFile(cacheFile)) return cacheFile;
      await fs.unlink(cacheFile).catch(() => {});
    } catch {
      // Not cached, generate
    }
    
    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Create absolute paths
    const absoluteCacheFile = path.resolve(cacheFile);
    const tempAiff = absoluteCacheFile.replace('.mp3', '.aiff');
    const tempTxt = absoluteCacheFile.replace('.mp3', '.txt');
    
    try {
      await fs.writeFile(tempTxt, text, 'utf8');

      // `say` on macOS outputs AIFF by default when using `-o`.
      // Use a fixed PCM format to avoid producing invalid/corrupt audio on some setups.
      try {
        await execAsync(
          `say -v ${JSON.stringify(voice || 'Alex')} -o "${tempAiff}" --data-format=LEI16@44100 -f "${tempTxt}"`
        );
      } catch {
        // Some macOS `say` versions don't support --data-format. Fall back to default AIFF output.
        await execAsync(
          `say -v ${JSON.stringify(voice || 'Alex')} -o "${tempAiff}" -f "${tempTxt}"`
        );
      }

      const aiffStat = await fs.stat(tempAiff).catch(() => null);
      if (!aiffStat?.size || aiffStat.size < 1000) {
        throw new Error(`Generated AIFF too small (${aiffStat?.size || 0} bytes)`);
      }

      // Convert to MP3.
      // Keep stderr for debugging if ffmpeg fails.
      await execAsync(
        `ffmpeg -f aiff -i "${tempAiff}" -vn -ar 44100 -ac 2 -codec:a libmp3lame -q:a 4 -y "${absoluteCacheFile}"`
      );

      if (!(await isValidAudioFile(absoluteCacheFile))) {
        throw new Error('Generated MP3 is invalid (ffprobe could not read duration)');
      }

      await fs.unlink(tempAiff).catch(() => {});
      await fs.unlink(tempTxt).catch(() => {});
      return absoluteCacheFile;
    } catch (error: any) {
      // Clean up on error
      await fs.unlink(tempAiff).catch(() => {});
      await fs.unlink(tempTxt).catch(() => {});
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
      if (await isValidAudioFile(cacheFile)) return cacheFile;
      await fs.unlink(cacheFile).catch(() => {});
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
    if (!(await isValidAudioFile(cacheFile))) {
      await fs.unlink(cacheFile).catch(() => {});
      throw new Error('ElevenLabs returned invalid audio payload');
    }
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
