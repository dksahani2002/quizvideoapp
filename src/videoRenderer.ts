import { renderQuizVideo } from './pipeline/orchestrator.js';
import { createTTSService } from './services/ttsService.js';
import { getDefaultConfig } from './config/defaultConfig.js';
import { Quiz } from './types/index.js';
import 'dotenv/config';

export async function renderVideo(quizzes: Quiz[], configOverrides?: Partial<typeof getDefaultConfig extends () => infer T ? T : never>): Promise<void> {
  const config = { ...getDefaultConfig(), ...configOverrides };

  const cfg = config as typeof config & {
    openaiApiKey?: string;
    openaiApiUrl?: string;
    elevenlabsApiKey?: string;
    elevenlabsModelId?: string;
  };
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey && config.ttsProvider === 'openai') {
    throw new Error('OPENAI_API_KEY environment variable required');
  }

  const ttsService = createTTSService(config.ttsProvider as 'openai' | 'system' | 'elevenlabs', {
    apiKey,
    model: config.ttsModel,
    cacheDir: config.cacheDir,
    elevenlabsApiKey: cfg.elevenlabsApiKey,
    elevenlabsModelId: cfg.elevenlabsModelId,
    openaiApiUrl: cfg.openaiApiUrl,
  });

  console.log('🚀 Starting quiz video rendering pipeline...\n');
  const result = await renderQuizVideo(quizzes, ttsService, config);

  if (result.success) {
    console.log(`\n✅ SUCCESS! Video rendered: ${result.outputFile}`);
    console.log(`   Duration: ${result.totalDuration?.toFixed(2)}s`);
    console.log(`   Segments: ${result.segments.filter(s => s.status === 'muxed').length}/${result.segments.length}`);
  } else {
    // IMPORTANT: never crash the server process here.
    // Callers (API/job runner/CLI) should decide how to surface the failure.
    const msg = result.errors.length ? result.errors.join('\n') : 'Video rendering failed';
    console.error(`\n❌ FAILED! Errors:\n${msg}`);
    throw new Error(msg);
  }
}
