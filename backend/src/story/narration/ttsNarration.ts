/**
 * Script + TTS synthesis path for story narration.
 *
 * Chunks long scripts, calls app TTS (OpenAI or ElevenLabs), concatenates MP3, then runs
 * Whisper for word-level timings. Caller: pipeline/run.ts when only `scriptText` is provided.
 */
import path from 'path';
import type OpenAI from 'openai';
import { createTTSService } from '../../common/services/ttsService.js';
import { resolveOpenAiCredentials, type AppSettings } from '../../common/services/settingsService.js';
import { applyServerTtsFallback, resolveTtsFromRequest, type ResolvedTts } from '../../mcq/videoJob/ttsResolution.js';
import { transcribeAudioVerbose } from '../ai/openaiStory.js';
import type { NarrationSegment } from '../lib/types.js';
import { concatAudioFilesMp3, extractAudioWav16kMono } from '../render/ffmpeg.js';

const MAX_TTS_CHUNK = 3800;

/**
 * Chunk long scripts by paragraph / size for TTS API limits.
 */
function chunkScriptForTts(script: string): string[] {
  const trimmed = script.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n\n' + p).length > MAX_TTS_CHUNK && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  if (chunks.length === 0) return [trimmed];
  return chunks;
}

function buildResolvedTts(settings: AppSettings, override: 'inherit' | 'openai' | 'elevenlabs'): ResolvedTts {
  const provider =
    override === 'inherit' ? (settings.tts.provider as 'openai' | 'system' | 'elevenlabs') : override;
  const fakeReq = {
    topic: '',
    questionCount: 0,
    mcqSource: 'manual' as const,
    ttsProvider: provider,
    ttsVoice: settings.tts.voice,
    ttsModel: 'tts-1',
    elevenlabsModelId: settings.elevenlabs.modelId,
    systemVoice: settings.tts.voice,
  };
  return applyServerTtsFallback(resolveTtsFromRequest(fakeReq as any, settings), settings);
}

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
  const creds = resolveOpenAiCredentials(settings);
  const resolved = buildResolvedTts(settings, ttsProvider);
  const cacheDir = path.join(workDir, 'tts-cache');
  const tts = createTTSService(resolved.provider, {
    apiKey: creds.apiKey || resolved.openaiKey,
    model: resolved.ttsModel,
    cacheDir,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolved.elevenlabsModelId,
    openaiApiUrl: creds.apiUrl,
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
