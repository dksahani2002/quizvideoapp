import { useState, useEffect } from 'react';
import { useSettings, useSaveSettings } from '../api/settings';
import { api } from '../api/client';
import { Save, Eye, EyeOff, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import type { ElevenLabsVoice } from '../types';

export function SettingsPage() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState({
    openaiKey: '', openaiUrl: 'https://api.openai.com/v1',
    ttsProvider: 'system' as 'system' | 'openai' | 'elevenlabs', ttsVoice: 'Alex',
    elevenlabsKey: '', elevenlabsVoiceId: '', elevenlabsVoiceName: '', elevenlabsModelId: 'eleven_turbo_v2_5',
    ytClientId: '', ytClientSecret: '', ytRedirectUri: '', ytRefreshToken: '',
    igUsername: '', igPassword: '',
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  const [elVoicesError, setElVoicesError] = useState('');
  const [elTestLoading, setElTestLoading] = useState(false);
  const [elTestResult, setElTestResult] = useState<string>('');
  const [elVoicesOpen, setElVoicesOpen] = useState(false);
  const [elKeySaved, setElKeySaved] = useState(false);
  const [elShowPaidOnly, setElShowPaidOnly] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setElKeySaved(settings.elevenlabs?.apiKey === '••••••••');
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
      igUsername: settings.instagram.username || '',
      igPassword: settings.instagram.password === '••••••••' ? '' : settings.instagram.password,
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
    } catch (e: any) {
      setElVoicesError(e.message || 'Failed to fetch voices');
      setElVoicesOpen(true);
    }
    setElVoicesLoading(false);
  }

  async function testElevenLabs() {
    setElTestLoading(true);
    setElTestResult('');
    try {
      const res = await api.post<{ success: boolean; data?: any; error?: string }>(
        '/api/settings/elevenlabs/test',
        { voiceId: form.elevenlabsVoiceId, modelId: form.elevenlabsModelId }
      );
      setElTestResult(res.success ? 'OK: voice/model works for your plan' : (res.error || 'Test failed'));
    } catch (e: any) {
      setElTestResult(e.message || 'Test failed');
    }
    setElTestLoading(false);
  }

  function handleSave() {
    const payload: Record<string, any> = {
      openai: { apiUrl: form.openaiUrl },
      tts: { provider: form.ttsProvider, voice: form.ttsVoice },
      elevenlabs: { voiceId: form.elevenlabsVoiceId, voiceName: form.elevenlabsVoiceName, modelId: form.elevenlabsModelId },
      youtube: { clientId: form.ytClientId, redirectUri: form.ytRedirectUri },
      instagram: { username: form.igUsername },
    };
    if (form.openaiKey && form.openaiKey !== '••••••••') payload.openai.apiKey = form.openaiKey;
    if (form.elevenlabsKey && form.elevenlabsKey !== '••••••••') payload.elevenlabs.apiKey = form.elevenlabsKey;
    if (form.ytClientSecret && form.ytClientSecret !== '••••••••') payload.youtube.clientSecret = form.ytClientSecret;
    if (form.ytRefreshToken && form.ytRefreshToken !== '••••••••') payload.youtube.refreshToken = form.ytRefreshToken;
    if (form.igPassword && form.igPassword !== '••••••••') payload.instagram.password = form.igPassword;

    save.mutate(payload, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  const toggle = (key: string) => setShowKeys(p => ({ ...p, [key]: !p[key] }));

  const Field = ({ label, field, secret, placeholder }: { label: string; field: keyof typeof form; secret?: boolean; placeholder?: string }) => (
    <div>
      <label className="block text-sm font-medium mb-1.5 text-[hsl(var(--muted-foreground))]">{label}</label>
      <div className="relative">
        <input
          type={secret && !showKeys[field] ? 'password' : 'text'}
          value={form[field]}
          onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/50 pr-10"
          placeholder={placeholder || (secret ? '••••••••' : '')}
        />
        {secret && (
          <button type="button" onClick={() => toggle(field)} className="absolute right-2.5 top-2 text-[hsl(var(--muted-foreground))]">
            {showKeys[field] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );

  const providerOptions: Array<{ key: 'system' | 'openai' | 'elevenlabs'; label: string }> = [
    { key: 'system', label: 'System (Free)' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'elevenlabs', label: 'ElevenLabs' },
  ];

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
            <Field label="API Key" field="openaiKey" secret />
            <Field label="API URL" field="openaiUrl" />
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
              <Field label="Voice" field="ttsVoice" placeholder={form.ttsProvider === 'openai' ? 'alloy, nova, shimmer...' : 'Alex, Samantha...'} />
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
                  field="elevenlabsKey"
                  secret
                  placeholder={elKeySaved && !form.elevenlabsKey ? 'Saved (hidden)' : '••••••••'}
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

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">YouTube</h2>
          <div className="space-y-4">
            <Field label="Client ID" field="ytClientId" />
            <Field label="Client Secret" field="ytClientSecret" secret />
            <Field label="Redirect URI" field="ytRedirectUri" />
            <Field label="Refresh Token" field="ytRefreshToken" secret />
          </div>
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-4">Instagram</h2>
          <div className="space-y-4">
            <Field label="Username" field="igUsername" />
            <Field label="Password" field="igPassword" secret />
          </div>
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
