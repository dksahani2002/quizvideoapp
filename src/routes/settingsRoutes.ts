import { Router, Request, Response } from 'express';
import { loadSettings, saveSettings } from '../services/settingsService.js';
import { fetchElevenLabsVoices } from '../services/ttsService.js';

export function createSettingsRoutes(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const settings = await loadSettings(userId);
      const masked = {
        ...settings,
        openai: { ...settings.openai, apiKey: settings.openai.apiKey ? '••••••••' : '' },
        elevenlabs: {
          ...settings.elevenlabs,
          apiKey: settings.elevenlabs.apiKey ? '••••••••' : '',
        },
        youtube: {
          ...settings.youtube,
          clientSecret: settings.youtube.clientSecret ? '••••••••' : '',
          refreshToken: settings.youtube.refreshToken ? '••••••••' : '',
        },
        instagram: {
          ...settings.instagram,
          password: settings.instagram.password ? '••••••••' : '',
        },
      };
      res.json({ success: true, data: masked });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.put('/', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const updated = await saveSettings(userId, req.body);
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Fetch ElevenLabs voices using the user's stored API key
  router.get('/elevenlabs/voices', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const settings = await loadSettings(userId);
      const apiKey = settings.elevenlabs.apiKey;
      if (!apiKey) {
        res.status(400).json({ success: false, error: 'ElevenLabs API key not configured. Add it in Settings first.' });
        return;
      }
      const voices = await fetchElevenLabsVoices(apiKey);
      res.json({ success: true, data: voices });
    } catch (error) {
      console.error('ElevenLabs voices fetch failed:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Test ElevenLabs voice/model availability (useful for free-tier restrictions)
  router.post('/elevenlabs/test', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const settings = await loadSettings(userId);
      const apiKey = settings.elevenlabs.apiKey;
      if (!apiKey) {
        res.status(400).json({ success: false, error: 'ElevenLabs API key not configured. Add it in Settings first.' });
        return;
      }

      const voiceId = req.body?.voiceId || settings.elevenlabs.voiceId || '21m00Tcm4TlvDq8ikWAM';
      const modelId = req.body?.modelId || settings.elevenlabs.modelId || 'eleven_turbo_v2_5';

      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'Test voice',
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        res.status(400).json({
          success: false,
          error: `ElevenLabs test failed (${r.status}): ${body || r.statusText}`,
        });
        return;
      }

      res.json({ success: true, data: { ok: true } });
    } catch (error) {
      console.error('ElevenLabs test failed:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}
