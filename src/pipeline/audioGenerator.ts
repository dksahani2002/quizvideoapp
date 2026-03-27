/**
 * Audio generation pipeline (Phase 2)
 * Generates TTS for each component and concatenates with normalization
 */

import { Quiz, SegmentMetadata, RenderConfig } from '../types/index.js';
import { TTSService } from '../services/ttsService.js';
import { concatAudio, extractDuration, mixBgmWithVoice, overlaySfx } from '../utils/ffmpeg.js';
import { sanitizeForTTS, generateCountdownText } from '../utils/textSanitizer.js';
import path from 'path';
import fs from 'fs/promises';
import { retryWithBackoff } from '../utils/retry.js';
import { getQuizUiStrings } from '../utils/quizUiStrings.js';

/**
 * Build cumulative concats with the same encoder as the full voice track, then
 * derive phase lengths from prefix durations. This matches what is actually
 * heard (muxed audio) — using per-clip ffprobe durations alone drifts vs the
 * concat output and desyncs video overlays from voice.
 */
async function measurePhasesFromConcatPrefixes(
  orderedFiles: string[],
  finalConcatPath: string,
  tempDir: string,
  sampleRate: number,
  channels: number
): Promise<{
  question: number;
  options: [number, number, number, number];
  countdown: number;
  answer: number;
  totalConcatDuration: number;
}> {
  const n = orderedFiles.length;
  if (n !== 7) {
    throw new Error(`Expected 7 ordered voice clips, got ${n}`);
  }

  const cumulative: number[] = [];
  for (let i = 0; i < n; i++) {
    const slice = orderedFiles.slice(0, i + 1);
    const outFile = i === n - 1 ? finalConcatPath : path.join(tempDir, `_prefix_${i}.mp3`);
    await concatAudio(slice, outFile, sampleRate, channels);
    const dur = await extractDuration(outFile);
    cumulative.push(dur);
    if (i < n - 1) {
      await fs.unlink(outFile).catch(() => {});
    }
  }

  const [c0, c1, c2, c3, c4, c5, c6] = cumulative;
  const d = (hi: number, lo: number) => Math.max(0.001, hi - lo);
  return {
    question: d(c0, 0),
    options: [d(c1, c0), d(c2, c1), d(c3, c2), d(c4, c3)],
    countdown: d(c5, c4),
    answer: d(c6, c5),
    totalConcatDuration: c6,
  };
}

/**
 * Generate audio for a single quiz segment
 */
export async function generateSegmentAudio(
  segmentId: string,
  quiz: Quiz,
  ttsService: TTSService,
  config: RenderConfig
): Promise<{
  audioFiles: SegmentMetadata['audioFiles'];
  audioConcatFile: string;
  audioDuration: number;
  componentDurations: {
    question: number;
    options: [number, number, number, number];
    countdown: number;
    answer: number;
  };
}> {
  const tempDir = path.join(config.tempDir, segmentId);
  await fs.mkdir(tempDir, { recursive: true });
  
  try {
    const voice = config.ttsVoice;
    // Generate TTS for each component
    const questionText = sanitizeForTTS(quiz.question);
    const countdownText = generateCountdownText(quiz.language);
    const ui = getQuizUiStrings(quiz.language);
    
    // Generate question audio
    const questionFile = path.join(tempDir, 'question.mp3');
    await retryWithBackoff(
      () => ttsService.generate(questionText, quiz.language || 'en', voice),
      3,
      [1000, 2000, 4000]
    ).then(file => fs.copyFile(file, questionFile));
    
    // Generate option audio files
    const optionFiles: [string, string, string, string] = ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const optionText = sanitizeForTTS(quiz.options[i]);
      const optionFile = path.join(tempDir, `option_${i}.mp3`);
      await retryWithBackoff(
        () => ttsService.generate(optionText, quiz.language || 'en', voice),
        3,
        [1000, 2000, 4000]
      ).then(file => fs.copyFile(file, optionFile));
      optionFiles[i] = optionFile;
    }
    
    // Generate countdown audio
    const countdownFile = path.join(tempDir, 'countdown.mp3');
    await retryWithBackoff(
      () => ttsService.generate(countdownText, quiz.language || 'en', voice),
      3,
      [1000, 2000, 4000]
    ).then(file => fs.copyFile(file, countdownFile));
    
    // Generate answer reveal audio
    const correctAnswer = quiz.options[quiz.answerIndex];
    const answerText = sanitizeForTTS(`${ui.correctAnswerPrefix} ${correctAnswer}`);
    const answerFile = path.join(tempDir, 'answer.mp3');
    await retryWithBackoff(
      () => ttsService.generate(answerText, quiz.language || 'en', voice),
      3,
      [1000, 2000, 4000]
    ).then(file => fs.copyFile(file, answerFile));
    
    // Concatenate all audio in order: question, options, countdown, answer
    const audioConcatFile = path.join(tempDir, 'audio_concat.mp3');
    const audioFiles = [
      questionFile,
      ...optionFiles,
      countdownFile,
      answerFile,
    ];
    
    const measured = await measurePhasesFromConcatPrefixes(
      audioFiles,
      audioConcatFile,
      tempDir,
      config.sampleRate,
      config.channels
    );
    const questionDuration = measured.question;
    const optionDurations = measured.options;
    const countdownDuration = measured.countdown;
    const answerDuration = measured.answer;
    const audioDuration = measured.totalConcatDuration;

    // Enforce minimum duration
    const finalDuration = Math.max(audioDuration, config.minSegmentDuration);

    // ── SFX overlay: tick at each option start, countdown ticks, ding at answer ──
    let enrichedAudioFile = audioConcatFile;

    const sfxEntries: Array<{ file: string; offsetMs: number; volume?: number }> = [];
    let cumulativeMs = Math.round(questionDuration * 1000);

    if (config.sfxTickFile) {
      for (let i = 0; i < 4; i++) {
        sfxEntries.push({ file: config.sfxTickFile, offsetMs: cumulativeMs, volume: 0.4 });
        cumulativeMs += Math.round(optionDurations[i] * 1000);
      }
    }

    if (config.sfxCountdownTickFile) {
      const cdEachMs = Math.round(countdownDuration * 1000 / 3);
      for (let i = 0; i < 3; i++) {
        sfxEntries.push({ file: config.sfxCountdownTickFile, offsetMs: cumulativeMs + i * cdEachMs, volume: 0.45 });
      }
    }
    cumulativeMs += Math.round(countdownDuration * 1000);

    if (config.sfxDingFile) {
      sfxEntries.push({ file: config.sfxDingFile, offsetMs: cumulativeMs, volume: 0.6 });
    }

    if (sfxEntries.length > 0) {
      const sfxFile = path.join(tempDir, 'audio_sfx.mp3');
      await overlaySfx(audioConcatFile, sfxEntries, sfxFile);
      enrichedAudioFile = sfxFile;
    }

    // ── BGM mix: layer background music under the voice + sfx ──
    if (config.bgmFile) {
      const bgmMixFile = path.join(tempDir, 'audio_final.mp3');
      await mixBgmWithVoice(enrichedAudioFile, config.bgmFile, bgmMixFile, config.bgmVolume ?? 0.12);
      enrichedAudioFile = bgmMixFile;
    }

    return {
      audioFiles: {
        question: questionFile,
        options: optionFiles,
        countdown: countdownFile,
        answer: answerFile,
      },
      audioConcatFile: enrichedAudioFile,
      audioDuration: finalDuration,
      componentDurations: {
        question: questionDuration,
        options: optionDurations,
        countdown: countdownDuration,
        answer: answerDuration,
      },
    };
  } catch (error: any) {
    // Cleanup on error
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
