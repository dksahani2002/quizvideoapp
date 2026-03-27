import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { loadEnvConfig } from "../config/envConfig.js";
import { loadSettings } from "../services/settingsService.js";
import { createTTSService } from "../services/ttsService.js";

const PREVIEW_MAX_CHARS = 500;

/**
 * POST /api/tts/preview
 * Returns a short MP3 using the same TTS stack as video rendering.
 */
export function createTtsPreviewRoutes() {
  const router = Router();

  router.post("/preview", async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const env = loadEnvConfig();
      const {
        text,
        ttsProvider: rawProvider,
        ttsVoice,
        ttsModel,
        systemVoice,
        elevenlabsModelId,
      } = req.body;

      const sample =
        typeof text === "string" && text.trim().length > 0
          ? text.trim().slice(0, PREVIEW_MAX_CHARS)
          : "This is a short voice preview for your quiz video.";

      const settings = await loadSettings(userId);
      const tts = (rawProvider || settings.tts.provider || "system") as
        | "openai"
        | "system"
        | "elevenlabs";

      if (tts === "system" && process.platform !== "darwin") {
        res.status(400).json({
          success: false,
          error: "System TTS is not available on this server. Choose OpenAI or ElevenLabs in Settings.",
        });
        return;
      }

      const openaiKey = (settings.openai.apiKey || '').trim();
      const openaiUrl = settings.openai.apiUrl || "https://api.openai.com/v1";

      let voice: string | undefined;
      if (tts === "elevenlabs") {
        voice = (typeof ttsVoice === "string" ? ttsVoice : undefined)?.trim() || settings.elevenlabs.voiceId;
      } else if (tts === "openai") {
        voice = (typeof ttsVoice === "string" ? ttsVoice : undefined)?.trim() || "alloy";
      } else {
        voice = (typeof systemVoice === "string" ? systemVoice : undefined)?.trim() || settings.tts.voice || "Alex";
      }

      if (tts === "openai" && !openaiKey) {
        res.status(400).json({ success: false, error: "OpenAI API key required. Add it in Settings." });
        return;
      }
      if (tts === "elevenlabs" && !settings.elevenlabs.apiKey?.trim()) {
        res.status(400).json({ success: false, error: "ElevenLabs API key required in Settings." });
        return;
      }

      const model = typeof ttsModel === "string" ? ttsModel.trim() : "tts-1";
      const elModel =
        (typeof elevenlabsModelId === "string" ? elevenlabsModelId.trim() : "") ||
        settings.elevenlabs.modelId ||
        "eleven_turbo_v2_5";

      const ttsService = createTTSService(tts, {
        apiKey: openaiKey,
        model,
        cacheDir: path.join(env.CACHE_DIR, "tts-preview"),
        openaiApiUrl: openaiUrl,
        elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
        elevenlabsModelId: elModel,
      });

      const audioPath = await ttsService.generate(sample, "en", voice);
      const buf = await fs.readFile(audioPath);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(buf);
    } catch (err: any) {
      console.error("TTS preview failed:", err?.message || err);
      res.status(500).json({ success: false, error: err?.message || "Failed to generate preview" });
    }
  });

  return router;
}
