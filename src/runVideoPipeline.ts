/**
 * Integration script: Generate MCQs and render video
 *
 * Usage:
 *   # OpenAI mode (default) — requires OPENAI_API_KEY (for local CLI usage)
 *   TOPIC="JavaScript Event Loop" npm run video
 *
 *   # Manual / file mode — reads MCQs from a local JSON file
 *   MCQ_SOURCE=file MCQ_FILE=./output/javascript-event-loop/mcqs.json npm run video
 *
 * TTS (intro/outro use the same voice as quiz narration):
 *   TTS_PROVIDER=system|openai|elevenlabs  (default: system)
 *   TTS_VOICE — OpenAI voice name, ElevenLabs voice id, or secondary for system
 *   SYSTEM_VOICE — macOS `say` voice when TTS_PROVIDER=system
 *   TTS_MODEL — OpenAI speech model (default: tts-1)
 *   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID — for ElevenLabs
 */

import { generateMCQs, loadMCQsFromFile, MCQ } from "./agents/mcqAgent.js";
import { buildImagePrompts } from "./agents/promptAgent.js";
import { exportAssets } from "./agents/exportAgent.js";
import { renderVideo } from "./videoRenderer.js";
import { createTTSService } from "./services/ttsService.js";
import { sanitizeForTTS } from "./utils/textSanitizer.js";
import { renderIntroSlide, renderOutroSlide } from "./utils/ffmpeg.js";
import { Quiz } from "./types/index.js";
import path from "path";
import fs from "fs";
import { mergeVideoTheme } from "./utils/videoTheme.js";
import { resolveFontFileForLanguage } from "./utils/quizFonts.js";
import { getQuizUiStrings, resolveIntroOutroScripts } from "./utils/quizUiStrings.js";
import "dotenv/config";

const MCQ_SOURCE = process.env.MCQ_SOURCE || "openai"; // "openai" | "file"
const MCQ_FILE = process.env.MCQ_FILE || "";
const TOPIC = process.env.TOPIC || "JavaScript Event Loop";
const QUESTION_COUNT = parseInt(process.env.QUESTION_COUNT || "0", 10);

async function runVideoPipeline() {
  try {
    console.log("🚀 Starting Quiz Video Pipeline\n");
    console.log(`📚 Topic: ${TOPIC}`);
    console.log(`📦 MCQ source: ${MCQ_SOURCE}\n`);

    // Step 1: Get MCQs — either from OpenAI or a local JSON file
    let mcqs: MCQ[];

    if (MCQ_SOURCE === "file") {
      if (!MCQ_FILE) {
        throw new Error(
          "MCQ_SOURCE=file requires MCQ_FILE env var pointing to a JSON file.\n" +
          "Example: MCQ_FILE=./output/javascript-event-loop/mcqs.json"
        );
      }
      console.log(`📂 Step 1: Loading MCQs from file: ${MCQ_FILE}`);
      mcqs = loadMCQsFromFile(MCQ_FILE);
    } else {
      console.log("🤖 Step 1: Generating MCQs via OpenAI...");
      mcqs = await generateMCQs(TOPIC);
      console.log(`✅ Generated ${mcqs.length} MCQs`);
    }

    if (QUESTION_COUNT > 0) {
      mcqs = mcqs.slice(0, QUESTION_COUNT);
      console.log(`🔢 Limited to ${mcqs.length} question(s) (QUESTION_COUNT=${QUESTION_COUNT})`);
    }
    console.log("");

    // Step 2: Export prompt assets (question/answer text files)
    console.log("📄 Step 2: Exporting prompt assets...");
    const prompts = buildImagePrompts(mcqs);
    exportAssets(TOPIC, mcqs, prompts);
    console.log(`✅ Exported ${prompts.length} prompt files\n`);

    // Step 3: Convert to Quiz format and render video
    console.log("🎬 Step 3: Rendering video...\n");
    const quizzes: Quiz[] = mcqs
      .map((mcq: MCQ): Quiz | null => {
        const options = Array.isArray(mcq.options)
          ? mcq.options
          : Object.values(mcq.options || {});

        if (options.length !== 4) {
          console.warn(`⚠️  Skipping quiz with ${options.length} options: ${mcq.question.substring(0, 50)}...`);
          return null;
        }

        return {
          question: mcq.question,
          options: options as [string, string, string, string],
          answerIndex: mcq.answerIndex as 0 | 1 | 2 | 3,
          language: "en",
        };
      })
      .filter((q): q is Quiz => q !== null);

    if (quizzes.length === 0) {
      throw new Error("No valid quizzes to render");
    }

    console.log(`📝 Rendering ${quizzes.length} valid quizzes\n`);

    const rawTts = (process.env.TTS_PROVIDER || "system").toLowerCase();
    const tts: "system" | "openai" | "elevenlabs" =
      rawTts === "elevenlabs" || rawTts === "openai" || rawTts === "system" ? rawTts : "system";

    const voiceFromEnv = process.env.TTS_VOICE?.trim();
    const systemVoiceEnv = process.env.SYSTEM_VOICE?.trim();
    let ttsVoice =
      tts === "elevenlabs"
        ? voiceFromEnv || process.env.ELEVENLABS_VOICE_ID?.trim() || ""
        : tts === "openai"
          ? voiceFromEnv || "alloy"
          : systemVoiceEnv || voiceFromEnv || "Alex";

    const ttsModel = process.env.TTS_MODEL?.trim() || "tts-1";
    const elevenModel = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_turbo_v2_5";
    const openaiKey = process.env.OPENAI_API_KEY;
    const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() || "";

    const fontFile = "./assets/fonts/Montserrat-Bold.ttf";
    const fontFallback = path.resolve(process.cwd(), fontFile);
    const tempDir = "./temp";

    // Step 3a: Generate intro/outro slides (voice matches main TTS)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const introFile = path.join(tempDir, "intro.mp4");
    const outroFile = path.join(tempDir, "outro.mp4");

    const introOutroCache = path.join(tempDir, "tts_cache_intro_outro");
    if (!fs.existsSync(introOutroCache)) fs.mkdirSync(introOutroCache, { recursive: true });

    const ttsForIntroOutro = createTTSService(tts, {
      apiKey: openaiKey,
      model: ttsModel,
      cacheDir: introOutroCache,
      elevenlabsApiKey: elevenKey || undefined,
      elevenlabsModelId: elevenModel,
      openaiApiUrl: process.env.OPENAI_URL || 'https://api.openai.com/v1',
    });

    const lang = quizzes[0]?.language || "en";
    const ui = getQuizUiStrings(lang);
    const topicSafe = sanitizeForTTS(TOPIC);
    const { introTemplate, outroTemplate } = resolveIntroOutroScripts(lang, undefined, undefined, undefined, undefined);
    const introSpeech = introTemplate.replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);
    const outroSpeech = outroTemplate.replace(/\{\{\s*topic\s*\}\}/gi, topicSafe);
    const fontForSlides = resolveFontFileForLanguage(lang, fontFallback);
    const pipelineTheme = process.env.BACKGROUND_IMAGE?.trim()
      ? {
          backgroundImage: path.resolve(process.cwd(), process.env.BACKGROUND_IMAGE.trim()),
          ...(process.env.BACKGROUND_OPACITY != null && process.env.BACKGROUND_OPACITY !== ""
            ? { backgroundOpacity: Math.min(1, Math.max(0, parseFloat(process.env.BACKGROUND_OPACITY))) }
            : {}),
        }
      : undefined;
    const themeLayerFromEnv = (imgEnv: string | undefined, opEnv: string | undefined) =>
      imgEnv?.trim()
        ? {
            backgroundImage: path.resolve(process.cwd(), imgEnv.trim()),
            ...(opEnv != null && opEnv !== ""
              ? { backgroundOpacity: Math.min(1, Math.max(0, parseFloat(opEnv))) }
              : {}),
          }
        : undefined;
    const introTheme = mergeVideoTheme(pipelineTheme, themeLayerFromEnv(process.env.INTRO_BACKGROUND_IMAGE, process.env.INTRO_BACKGROUND_OPACITY));
    const outroTheme = mergeVideoTheme(pipelineTheme, themeLayerFromEnv(process.env.OUTRO_BACKGROUND_IMAGE, process.env.OUTRO_BACKGROUND_OPACITY));

    let introVoiceFile = "./assets/audio/intro_voice.mp3";
    let outroVoiceFile = "./assets/audio/outro_voice.mp3";
    try {
      introVoiceFile = await ttsForIntroOutro.generate(introSpeech, lang, ttsVoice);
      outroVoiceFile = await ttsForIntroOutro.generate(outroSpeech, lang, ttsVoice);
    } catch (e: any) {
      console.warn("Intro/outro TTS failed, using bundled fallback audio:", e?.message || e);
    }

    console.log("🎬 Generating intro/outro slides...");
    await renderIntroSlide(introFile, TOPIC, {
      width: 1080, height: 1920, fps: 30, fontFile: fontForSlides,
      voiceFile: introVoiceFile,
      bgmFile: "./assets/audio/bgm.mp3",
      dingFile: "./assets/audio/ding.mp3",
      subtitle: ui.introSubtitle,
      theme: introTheme,
    });
    await renderOutroSlide(outroFile, {
      width: 1080, height: 1920, fps: 30, fontFile: fontForSlides,
      voiceFile: outroVoiceFile,
      bgmFile: "./assets/audio/bgm.mp3",
      line1Text: ui.outroLine1,
      line2Text: ui.outroLine2,
      theme: outroTheme,
    });
    console.log("✅ Intro/outro slides ready\n");

    await renderVideo(quizzes, {
      fontFile: fontFallback,
      tempDir,
      outputDir: "./output/videos",
      cacheDir: "./cache",
      ttsProvider: tts,
      ttsVoice: ttsVoice || undefined,
      ...(tts === "openai" ? { ttsModel } : {}),
      introVideo: introFile,
      outroVideo: outroFile,
      theme: pipelineTheme,
      elevenlabsApiKey: elevenKey || undefined,
      elevenlabsModelId: elevenModel,
      openaiApiKey: openaiKey || undefined,
      openaiApiUrl: process.env.OPENAI_URL || 'https://api.openai.com/v1',
    } as any);

    console.log("\n🎉 Pipeline completed successfully!");
  } catch (error: any) {
    console.error("\n❌ Pipeline failed:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

runVideoPipeline();
