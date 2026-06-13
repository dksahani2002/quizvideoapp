/**
 * Script + TTS synthesis path for story narration.
 *
 * Chunks long scripts, calls app TTS (OpenAI or ElevenLabs), concatenates MP3, then runs
 * Whisper for word-level timings.
 */
import path from 'path';
import type OpenAI from 'openai';
import { transcribeAudioVerbose } from '../ai/index.js';
import type { AppSettings } from '../../common/services/settingsService.js';
import type { NarrationSegment } from '../../story/lib/types.js';
import { concatAudioFilesMp3, extractAudioWav16kMono } from '../media/audio.js';
import { createTtsFromSettings } from './ttsFactory.js';
import { chunkScriptForTts } from './scriptChunker.js';

/**
 * Full script → TTS MP3(s) → Whisper → timed {@link NarrationSegment} list.
 *
 * Respects `ttsProvider` override and app Settings voice/model. Output MP3 is muxed
 * onto the final video in pipeline/run.ts.
 */
export async function synthesizeScriptToNarration(params: {
  script: string;
  settings: AppSettings;
  workDir: string;
  openai: OpenAI;
  language: string;
  ttsProvider: 'inherit' | 'openai' | 'elevenlabs';
}): Promise<{
  narration: NarrationSegment[];
  narrationMp3Path: string;
  /** Language Whisper inferred from the TTS output (if available). */
  detectedLanguage?: string;
}> {
  const { script, settings, workDir, openai, language, ttsProvider } = params;
  const cacheDir = path.join(workDir, 'tts-cache');
  const { tts, resolved } = createTtsFromSettings(settings, cacheDir, {
    ttsProvider: ttsProvider === 'inherit' ? 'inherit' : ttsProvider,
    ttsVoice: settings.tts.voice,
    ttsModel: 'tts-1',
    elevenlabsModelId: settings.elevenlabs.modelId,
    systemVoice: settings.tts.voice,
  });

  const chunks = chunkScriptForTts(script);
  if (chunks.length === 0) {
    throw new Error('Empty script for TTS');
  }

  const mp3Parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = path.join(workDir, `tts_part_${i}.mp3`);
    const file = await tts.generate(chunks[i], language, resolved.voice);
    const fs = await import('fs/promises');
    await fs.copyFile(file, out);
    mp3Parts.push(out);
  }

  const narrationMp3Path = path.join(workDir, 'narration_tts_full.mp3');
  await concatAudioFilesMp3(mp3Parts, narrationMp3Path);

  const wav = path.join(workDir, 'narration_tts.wav');
  await extractAudioWav16kMono(narrationMp3Path, wav);
  const { segments: whisper, language: detectedLanguage } = await transcribeAudioVerbose(openai, wav);

  const narration: NarrationSegment[] = whisper.map((w, index) => ({
    index,
    text: w.text.trim(),
    startSec: w.start,
    endSec: w.end,
  }));

  if (narration.length === 0) {
    throw new Error('TTS produced no transcribable segments');
  }

  return { narration, narrationMp3Path, detectedLanguage };
}
