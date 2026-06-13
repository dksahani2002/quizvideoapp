import path from 'path';
import { sanitizeForTTS } from '../../common/utils/textSanitizer.js';
import { renderIntroSlide, renderOutroSlide } from '../../common/utils/ffmpeg.js';
import type { Quiz, VideoTheme } from '../../common/types/index.js';
import type { AppSettings } from '../../common/services/settingsService.js';
import { mergeVideoTheme } from '../utils/videoTheme.js';
import { resolveFontFileForLanguage } from '../utils/quizFonts.js';
import { getQuizUiStrings, resolveIntroOutroScripts } from '../../common/i18n/quizUiStrings.js';
import type { GenerateRequestPayload } from './types.js';
import { createIntroOutroTtsService, type ResolvedTts } from '../../capabilities/voice/index.js';
import { assetPath } from '../../common/config/paths.js';
import {
  appendJobEvent,
  isCancelRequested,
  setVideoProgress,
  videoRowExists,
} from './progress.js';
import type { TTSService } from '../../common/services/ttsService.js';

export type IntroOutroPaths = { introFile: string; outroFile: string };

async function generateIntroOutroSpeechFiles(
  tts: TTSService,
  lang: string,
  voice: string | undefined,
  introSpeech: string,
  outroSpeech: string
): Promise<{ introVoiceFile: string; outroVoiceFile: string }> {
  let introVoiceFile = assetPath('audio', 'intro_voice.mp3');
  let outroVoiceFile = assetPath('audio', 'outro_voice.mp3');
  try {
    introVoiceFile = await tts.generate(introSpeech, lang, voice);
    outroVoiceFile = await tts.generate(outroSpeech, lang, voice);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Intro/outro TTS failed, using bundled fallback audio:', msg);
  }
  return { introVoiceFile, outroVoiceFile };
}

/**
 * Renders intro + outro MP4 segments (TTS + ffmpeg slides).
 * Returns `null` if the video document was removed mid-run (caller should exit without failing).
 */
export async function runIntroOutroPhase(params: {
  videoId: string;
  req: GenerateRequestPayload;
  settings: AppSettings;
  quizzes: Quiz[];
  tempDir: string;
  fontFallback: string;
  resolvedTts: ResolvedTts;
  introOutroCacheDir: string;
}): Promise<IntroOutroPaths | null> {
  const { videoId, req, settings, quizzes, tempDir, fontFallback, resolvedTts, introOutroCacheDir } =
    params;

  const ttsForIntroOutro = createIntroOutroTtsService(resolvedTts, settings, introOutroCacheDir);

  const lang = quizzes[0]?.language || 'en';
  const ui = getQuizUiStrings(lang);
  const topicSafe = sanitizeForTTS(req.topic || 'Quiz');
  const { introTemplate, outroTemplate } = resolveIntroOutroScripts(
    lang,
    req.introScript,
    req.outroScript,
    settings.brand?.introScript,
    settings.brand?.outroScript
  );
  const cta = (req.ctaLine || settings.brand?.ctaLine || '').trim();
  const introSpeech = introTemplate.replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);
  const outroSpeech = (cta ? `${outroTemplate} ${cta}` : outroTemplate).replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);
  const fontForSlides = resolveFontFileForLanguage(lang, fontFallback);
  const introTheme = mergeVideoTheme(req.theme as VideoTheme | undefined, req.introTheme as VideoTheme | undefined);
  const outroTheme = mergeVideoTheme(req.theme as VideoTheme | undefined, req.outroTheme as VideoTheme | undefined);

  const { introVoiceFile, outroVoiceFile } = await generateIntroOutroSpeechFiles(
    ttsForIntroOutro,
    lang,
    resolvedTts.voice,
    introSpeech,
    outroSpeech
  );

  const introFile = path.join(tempDir, 'intro.mp4');
  const outroFile = path.join(tempDir, 'outro.mp4');

  await setVideoProgress(videoId, 'intro', 'Rendering intro');
  await appendJobEvent(videoId, 'intro', 'Rendering intro');
  await renderIntroSlide(introFile, req.topic || 'Quiz', {
    width: 1080,
    height: 1920,
    fps: 30,
    fontFile: fontForSlides,
    voiceFile: introVoiceFile,
      bgmFile: assetPath('audio', 'bgm.mp3'),
      dingFile: assetPath('audio', 'ding.mp3'),
    subtitle: ui.introSubtitle,
    theme: introTheme,
  });

  if (!(await videoRowExists(videoId))) {
    return null;
  }
  if (await isCancelRequested(videoId)) {
    throw new Error('Cancelled');
  }

  await setVideoProgress(videoId, 'outro', 'Rendering outro');
  await appendJobEvent(videoId, 'outro', 'Rendering outro');
  await renderOutroSlide(outroFile, {
    width: 1080,
    height: 1920,
    fps: 30,
    fontFile: fontForSlides,
    voiceFile: outroVoiceFile,
    bgmFile: assetPath('audio', 'bgm.mp3'),
    line1Text: ui.outroLine1,
    line2Text: ui.outroLine2,
    theme: outroTheme,
  });

  if (!(await videoRowExists(videoId))) {
    return null;
  }
  if (await isCancelRequested(videoId)) {
    throw new Error('Cancelled');
  }

  return { introFile, outroFile };
}
