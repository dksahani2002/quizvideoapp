import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSettings, useSaveSettings, type DeepPartial } from '../api/settings';
import { api } from '../api/client';
import { Save, Eye, EyeOff, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import type { AppSettings, ElevenLabsVoice } from '../types';

function Field({
  label,
  value,
  onChange,
  secret,
  placeholder,
  revealed,
  onToggleReveal,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  placeholder?: string;
  revealed?: boolean;
  onToggleReveal?: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5 text-[hsl(var(--muted-foreground))]">{label}</label>
      <div className="relative">
        <input
          type={secret && !revealed ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50 pr-10"
          placeholder={placeholder || (secret ? '••••••••' : '')}
        />
        {secret && (
          <button
            type="button"
            onClick={onToggleReveal}
            className="absolute right-2.5 top-2 text-[hsl(var(--muted-foreground))]"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const loc = useLocation();
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const youtubeRef = useRef<HTMLElement | null>(null);
  const instagramRef = useRef<HTMLElement | null>(null);
  const focus = useMemo(() => {
    const p = new URLSearchParams(loc.search);
    return (p.get('focus') || '').toLowerCase();
  }, [loc.search]);
  const [form, setForm] = useState({
    openaiKey: '', openaiUrl: 'https://api.openai.com/v1',
    ttsProvider: 'system' as 'system' | 'openai' | 'elevenlabs', ttsVoice: 'Alex',
    elevenlabsKey: '', elevenlabsVoiceId: '', elevenlabsVoiceName: '', elevenlabsModelId: 'eleven_turbo_v2_5',
    ytClientId: '', ytClientSecret: '', ytRedirectUri: '', ytRefreshToken: '',
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  const [elVoicesError, setElVoicesError] = useState('');
  const [elTestLoading, setElTestLoading] = useState(false);
  const [elTestResult, setElTestResult] = useState<string>('');
  const [elVoicesOpen, setElVoicesOpen] = useState(false);
  const [elShowPaidOnly, setElShowPaidOnly] = useState(false);

  const elKeySaved = useMemo(() => settings?.elevenlabs?.apiKey === '••••••••', [settings]);

  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      openaiKey: settings.openai.apiKey === '••••••••' ? '' : settings.openai.apiKey,
      openaiUrl: settings.openai.apiUrl || 'https://api.openai.com/v1',
      ttsProvider: settings.tts.provider,
      ttsVoice: settings.tts.voice || 'Alex',
      elevenlabsKey: settings.elevenlabs?.apiKey === '••••••••' ? '' : (settings.elevenlabs?.apiKey || ''),
      elevenlabsVoiceId: settings.elevenlabs?.voiceId || '',
      elevenlabsVoiceName: settings.elevenlabs?.voiceName || '',
      elevenlabsModelId: settings.elevenlabs?.modelId || 'eleven_turbo_v2_5',
      ytClientId: settings.youtube.clientId || '',
      ytClientSecret: settings.youtube.clientSecret === '••••••••' ? '' : settings.youtube.clientSecret,
      ytRedirectUri: settings.youtube.redirectUri || '',
      ytRefreshToken: settings.youtube.refreshToken === '••••••••' ? '' : settings.youtube.refreshToken,
    });
  }, [settings]);

  async function fetchVoices() {
    setElVoicesLoading(true);
    setElVoicesError('');
    try {
      const res = await api.get<{ success: boolean; data: ElevenLabsVoice[]; error?: string }>('/api/settings/elevenlabs/voices');
      if (res.success) {
        setElVoices(res.data);
        setElVoicesOpen(true);
      } else {
        setElVoicesError(res.error || 'Failed to fetch voices');
        setElVoicesOpen(true);
      }
    } catch (e: unknown) {
      setElVoicesError(e instanceof Error ? e.message : 'Failed to fetch voices');
      setElVoicesOpen(true);
    }
    setElVoicesLoading(false);
  }

  async function testElevenLabs() {
    setElTestLoading(true);
    setElTestResult('');
    try {
      const res = await api.post<{ success: boolean; data?: unknown; error?: string }>(
        '/api/settings/elevenlabs/test',
        { voiceId: form.elevenlabsVoiceId, modelId: form.elevenlabsModelId }
      );
      setElTestResult(res.success ? 'OK: voice/model works for your plan' : (res.error || 'Test failed'));
    } catch (e: unknown) {
      setElTestResult(e instanceof Error ? e.message : 'Test failed');
    }
    setElTestLoading(false);
  }

  function handleSave() {
    const payload: DeepPartial<AppSettings> = {
      openai: {
        apiUrl: form.openaiUrl,
        ...(form.openaiKey && form.openaiKey !== '••••••••' ? { apiKey: form.openaiKey } : {}),
      },
      tts: { provider: form.ttsProvider, voice: form.ttsVoice },
      elevenlabs: {
        voiceId: form.elevenlabsVoiceId,
        voiceName: form.elevenlabsVoiceName,
        modelId: form.elevenlabsModelId,
        ...(form.elevenlabsKey && form.elevenlabsKey !== '••••••••' ? { apiKey: form.elevenlabsKey } : {}),
      },
      youtube: {
        clientId: form.ytClientId,
        redirectUri: form.ytRedirectUri,
        ...(form.ytClientSecret && form.ytClientSecret !== '••••••••' ? { clientSecret: form.ytClientSecret } : {}),
        ...(form.ytRefreshToken && form.ytRefreshToken !== '••••••••' ? { refreshToken: form.ytRefreshToken } : {}),
      },
    };

    save.mutate(payload, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  const toggle = (key: string) => setShowKeys(p => ({ ...p, [key]: !p[key] }));

  const providerOptions: Array<{ key: 'system' | 'openai' | 'elevenlabs'; label: string }> = [
    { key: 'system', label: 'System (Free)' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'elevenlabs', label: 'ElevenLabs' },
  ];

  useEffect(() => {
    if (focus === 'youtube') youtubeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focus === 'instagram') instagramRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Configure API credentials and preferences</p>
      </div>

      <div className="space-y-8">
        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">OpenAI / LLM</h2>
          <div className="space-y-4">
            <Field
              label="API Key"
              value={form.openaiKey}
              onChange={(v) => setForm(p => ({ ...p, openaiKey: v }))}
              secret
              revealed={!!showKeys.openaiKey}
              onToggleReveal={() => toggle('openaiKey')}
            />
            <Field
              label="API URL"
              value={form.openaiUrl}
              onChange={(v) => setForm(p => ({ ...p, openaiUrl: v }))}
            />
          </div>
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">Text-to-Speech</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[hsl(var(--muted-foreground))]">Provider</label>
              <div className="flex gap-2">
                {providerOptions.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setForm(f => ({ ...f, ttsProvider: p.key }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      form.ttsProvider === p.key
                        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                        : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {form.ttsProvider !== 'elevenlabs' && (
              <Field
                label="Voice"
                value={form.ttsVoice}
                onChange={(v) => setForm(p => ({ ...p, ttsVoice: v }))}
                placeholder={form.ttsProvider === 'openai' ? 'alloy, nova, shimmer...' : 'Alex, Samantha...'}
              />
            )}
          </div>
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">ElevenLabs</h2>
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field
                  label="API Key"
                  value={form.elevenlabsKey}
                  onChange={(v) => setForm(p => ({ ...p, elevenlabsKey: v }))}
                  secret
                  placeholder={elKeySaved && !form.elevenlabsKey ? 'Saved (hidden)' : '••••••••'}
                  revealed={!!showKeys.elevenlabsKey}
                  onToggleReveal={() => toggle('elevenlabsKey')}
                />
              </div>
              {elKeySaved && !form.elevenlabsKey && (
                <span className="mb-2 text-xs text-green-400">Saved</span>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[hsl(var(--muted-foreground))]">Model</label>
              <select
                value={form.elevenlabsModelId}
                onChange={(e) => setForm(f => ({ ...f, elevenlabsModelId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50"
              >
                <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 (recommended)</option>
                <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
                <option value="eleven_flash_v2_5">eleven_flash_v2_5</option>
                <option value="eleven_v3">eleven_v3</option>
              </select>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                If you are on the free tier, pick a model available to your plan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={testElevenLabs}
                disabled={elTestLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {elTestLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Test Voice/Model
              </button>
              {elTestResult && (
                <span className="text-xs text-[hsl(var(--muted-foreground))] wrap-break-word">{elTestResult}</span>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-[hsl(var(--muted-foreground))]">Voice</label>
                <button
                  onClick={fetchVoices}
                  disabled={elVoicesLoading}
                  className="flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
                >
                  {elVoicesLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {elVoices.length > 0 ? 'Refresh Voices' : 'Load Voices'}
                </button>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
                Some voices (Voice Library) require a paid ElevenLabs plan for API usage. If generation fails with
                <span className="font-medium"> paid_plan_required</span>, pick a different voice or upgrade.
              </p>
              {elVoicesError && (
                <p className="text-xs text-[hsl(var(--destructive))] mb-2">{elVoicesError}</p>
              )}
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                {form.elevenlabsVoiceName ? (
                  <p>Selected: <span className="font-medium text-[hsl(var(--foreground))]">{form.elevenlabsVoiceName}</span></p>
                ) : (
                  <p>Select a voice to use for ElevenLabs.</p>
                )}
              </div>

              {elVoicesOpen && (
                <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Available voices</p>
                    <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                      <input
                        type="checkbox"
                        checked={elShowPaidOnly}
                        onChange={(e) => setElShowPaidOnly(e.target.checked)}
                        className="accent-[hsl(var(--primary))]"
                      />
                      Show paid-only
                    </label>
                    <button
                      onClick={() => setElVoicesOpen(false)}
                      className="text-xs text-[hsl(var(--primary))] hover:underline"
                    >
                      Close
                    </button>
                  </div>
                  {elVoices.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {elVoices
                        .filter(v => elShowPaidOnly ? true : v.category !== 'professional')
                        .map(v => {
                          const paidOnly = v.category === 'professional';
                          return (
                        <button
                          key={v.voice_id}
                          disabled={paidOnly}
                          onClick={() => {
                            if (paidOnly) return;
                            setForm(f => ({ ...f, elevenlabsVoiceId: v.voice_id, elevenlabsVoiceName: v.name }));
                            setElVoicesOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${
                            form.elevenlabsVoiceId === v.voice_id
                              ? 'bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border border-[hsl(var(--primary))]/30'
                              : paidOnly
                                ? 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] opacity-50 cursor-not-allowed'
                                : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/30'
                          }`}
                        >
                          <span className="font-medium">{v.name}</span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {v.category}{paidOnly ? ' (paid)' : ''}
                          </span>
                        </button>
                      );
                    })}
                    </div>
                  ) : (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {elVoicesError ? 'Fix the error above, then retry.' : 'No voices loaded yet.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section ref={(el) => { youtubeRef.current = el; }} className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">YouTube</h2>
          <div className="space-y-4">
            <Field
              label="Client ID"
              value={form.ytClientId}
              onChange={(v) => setForm(p => ({ ...p, ytClientId: v }))}
            />
            <Field
              label="Client Secret"
              value={form.ytClientSecret}
              onChange={(v) => setForm(p => ({ ...p, ytClientSecret: v }))}
              secret
              revealed={!!showKeys.ytClientSecret}
              onToggleReveal={() => toggle('ytClientSecret')}
            />
            <Field
              label="Redirect URI"
              value={form.ytRedirectUri}
              onChange={(v) => setForm(p => ({ ...p, ytRedirectUri: v }))}
            />
            <Field
              label="Refresh Token"
              value={form.ytRefreshToken}
              onChange={(v) => setForm(p => ({ ...p, ytRefreshToken: v }))}
              secret
              revealed={!!showKeys.ytRefreshToken}
              onToggleReveal={() => toggle('ytRefreshToken')}
            />
          </div>
        </section>

        <section ref={(el) => { instagramRef.current = el; }} className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-2">Instagram (Meta Graph API)</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Instagram publishing is now handled via the official Meta Graph API (no password login).
            Connect your account in the Publishing section once enabled.
          </p>
        </section>

        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saved ? <CheckCircle size={18} /> : <Save size={18} />}
          {saved ? 'Saved!' : save.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
