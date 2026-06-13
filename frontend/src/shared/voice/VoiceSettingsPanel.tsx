import { useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { previewTts } from '../../api/tts';
import type { VoiceOptions, VoiceProvider } from './types';
import { useElevenLabsVoices } from './useElevenLabsVoices';

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

type Props = {
  value: VoiceOptions;
  onChange: (next: VoiceOptions) => void;
  disabled?: boolean;
  allowInherit?: boolean;
  allowSystem?: boolean;
  previewText?: string;
  showNarrationLanguage?: boolean;
  reRenderHint?: boolean;
};

export function VoiceSettingsPanel({
  value,
  onChange,
  disabled,
  allowInherit = false,
  allowSystem = true,
  previewText = 'This is a preview of the voiceover.',
  showNarrationLanguage = true,
  reRenderHint = true,
}: Props) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const elEnabled = value.ttsProvider === 'elevenlabs' || value.ttsProvider === 'inherit';
  const { voices: elVoices, loading: elLoading } = useElevenLabsVoices(elEnabled);

  async function handlePreview() {
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const base = {
        text: previewText,
        language: value.narrationLanguage || 'en',
      };

      let params;
      if (value.ttsProvider === 'inherit') {
        params = {
          ...base,
          ...(value.ttsVoice ? { ttsVoice: value.ttsVoice, ttsModel: value.ttsModel } : {}),
        } as Parameters<typeof previewTts>[0];
      } else if (value.ttsProvider === 'openai') {
        params = {
          ...base,
          ttsProvider: 'openai' as const,
          ttsVoice: value.ttsVoice || 'alloy',
          ttsModel: value.ttsModel,
        };
      } else if (value.ttsProvider === 'system') {
        params = {
          ...base,
          ttsProvider: 'system' as const,
          systemVoice: value.systemVoice || undefined,
        };
      } else {
        params = {
          ...base,
          ttsProvider: 'elevenlabs' as const,
          ttsVoice: value.ttsVoice || undefined,
          elevenlabsModelId: value.elevenlabsModelId || undefined,
        };
      }

      const blob = await previewTts(params);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }

  function setProvider(ttsProvider: VoiceProvider) {
    onChange({ ...value, ttsProvider });
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] p-4 bg-[hsl(var(--card))] space-y-4">
      <div className="flex items-center gap-2">
        <Volume2 size={18} className="text-[hsl(var(--primary))]" />
        <h2 className="text-sm font-semibold">Voiceover (TTS)</h2>
      </div>

      <label className="block text-sm">
        <span className="font-medium mb-1 block">Provider</span>
        <select
          disabled={disabled}
          value={value.ttsProvider}
          onChange={(e) => setProvider(e.target.value as VoiceProvider)}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
        >
          {allowInherit && <option value="inherit">Use Settings default</option>}
          <option value="openai">OpenAI</option>
          <option value="elevenlabs">ElevenLabs</option>
          {allowSystem && <option value="system">System (macOS)</option>}
        </select>
      </label>

      {(value.ttsProvider === 'openai' || value.ttsProvider === 'inherit') && (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium mb-1 block">
              {value.ttsProvider === 'inherit' ? 'OpenAI voice (optional override)' : 'OpenAI voice'}
            </span>
            <select
              disabled={disabled}
              value={value.ttsVoice || 'alloy'}
              onChange={(e) => onChange({ ...value, ttsVoice: e.target.value })}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium mb-1 block">TTS model</span>
            <select
              disabled={disabled}
              value={value.ttsModel}
              onChange={(e) =>
                onChange({ ...value, ttsModel: e.target.value as 'tts-1' | 'tts-1-hd' })
              }
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            >
              <option value="tts-1">tts-1 (faster)</option>
              <option value="tts-1-hd">tts-1-hd (higher quality)</option>
            </select>
          </label>
        </div>
      )}

      {value.ttsProvider === 'system' && (
        <label className="block text-sm">
          <span className="font-medium mb-1 block">System voice (say -v)</span>
          <input
            disabled={disabled}
            value={value.systemVoice}
            onChange={(e) => onChange({ ...value, systemVoice: e.target.value })}
            placeholder="Alex, Samantha, Daniel…"
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          />
        </label>
      )}

      {value.ttsProvider === 'elevenlabs' && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium mb-1 block">ElevenLabs voice</span>
            {elLoading ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading voices…</p>
            ) : (
              <select
                disabled={disabled || elVoices.length === 0}
                value={value.ttsVoice}
                onChange={(e) => onChange({ ...value, ttsVoice: e.target.value })}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              >
                <option value="">Use Settings default</option>
                {elVoices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="block text-sm">
            <span className="font-medium mb-1 block">Model (optional)</span>
            <input
              disabled={disabled}
              value={value.elevenlabsModelId}
              onChange={(e) => onChange({ ...value, elevenlabsModelId: e.target.value })}
              placeholder="eleven_turbo_v2_5"
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}

      {showNarrationLanguage && (
        <label className="block text-sm">
          <span className="font-medium mb-1 block">Narration language</span>
          <input
            disabled={disabled}
            value={value.narrationLanguage}
            onChange={(e) => onChange({ ...value, narrationLanguage: e.target.value })}
            placeholder="en"
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={disabled || previewLoading}
          onClick={() => void handlePreview()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm hover:bg-[hsl(var(--secondary))] disabled:opacity-50"
        >
          {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
          Preview voice
        </button>
        {value.ttsProvider === 'inherit' && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Default provider and voice come from Settings unless overridden above.
          </p>
        )}
      </div>
      {previewError && <p className="text-xs text-[hsl(var(--destructive))]">{previewError}</p>}
      {reRenderHint && value.ttsProvider !== 'inherit' && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Re-render after changing voice to apply it to the video.
        </p>
      )}
    </div>
  );
}
