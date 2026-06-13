import path from 'path';
import type { EnvConfig } from '../../common/config/envConfig.js';
import type { Quiz } from '../../common/types/index.js';
import type { AppSettings } from '../../common/services/settingsService.js';
import { renderVideo } from '../videoRenderer.js';
import type { GenerateRequestPayload } from './types.js';
import type { ResolvedTts } from './ttsResolution.js';

/**
 * Quiz body + concat with intro/outro — full pipeline after intro/outro segments exist.
 */
export async function runMainRenderPhase(params: {
  quizzes: Quiz[];
  req: GenerateRequestPayload;
  settings: AppSettings;
  env: EnvConfig;
  userId: string;
  userVideoDir: string;
  tempDir: string;
  fontFallback: string;
  resolvedTts: ResolvedTts;
  introFile: string;
  outroFile: string;
}): Promise<void> {
  const {
    quizzes,
    req,
    settings,
    env,
    userId,
    userVideoDir,
    tempDir,
    fontFallback,
    resolvedTts,
    introFile,
    outroFile,
  } = params;

  const opts = {
    fontFile: fontFallback,
    tempDir,
    outputDir: userVideoDir,
    cacheDir: path.join(env.CACHE_DIR, userId),
    ttsProvider: resolvedTts.provider,
    ttsVoice: resolvedTts.voice || undefined,
    ...(resolvedTts.provider === 'openai' ? { ttsModel: resolvedTts.ttsModel } : {}),
    introVideo: introFile,
    outroVideo: outroFile,
    theme: req.theme || undefined,
    textAlign: req.textAlign || undefined,
    layoutDensity: typeof req.layoutDensity === 'number' ? req.layoutDensity : undefined,
    headerTitle: req.headerTitle?.trim() || undefined,
    captions: { enabled: true, burnIn: !!req.captionsBurnIn },
    watermark: settings.brand?.watermarkImage
      ? {
          imagePath: settings.brand.watermarkImage,
          opacity: settings.brand.watermarkOpacity,
          position: settings.brand.watermarkPosition,
        }
      : undefined,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolvedTts.elevenlabsModelId,
    openaiApiKey: resolvedTts.openaiKey || undefined,
    openaiApiUrl: settings.openai.apiUrl || undefined,
  };

  await renderVideo(quizzes, opts as any);
}
