import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export function PublishingPage() {
  const navigate = useNavigate();
  const [ytUrl, setYtUrl] = useState<string>('');
  const [igUrl, setIgUrl] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const redirectTimer = useRef<number | null>(null);
  const [exportVideoId, setExportVideoId] = useState('');
  const [exportPlatform, setExportPlatform] = useState<'tiktok' | 'x' | 'snapchat'>('tiktok');
  type ExportPlan = {
    constraints?: { aspect?: string; maxDurationSec?: number };
    suggestedCaption?: string;
    checklist?: string[];
  };
  const [exportPlan, setExportPlan] = useState<ExportPlan | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current);
    };
  }, []);

  async function loadYouTubeConnect() {
    setMsg('');
    setError('');
    setYtUrl('');
    try {
      const r = await api.get<{ success: boolean; data: { url: string } }>('/api/publish/youtube/connect-url');
      setYtUrl(r.data.url);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'Failed to generate YouTube connect link';
      setError(`${reason} Redirecting to Settings…`);
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current);
      redirectTimer.current = window.setTimeout(() => {
        navigate('/settings?focus=youtube');
      }, 1200);
    }
  }

  async function loadInstagramConnect() {
    setMsg('');
    setError('');
    setIgUrl('');
    try {
      const r = await api.get<{ success: boolean; data: { url: string } }>('/api/publish/instagram/connect-url');
      setIgUrl(r.data.url);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'Failed to generate Instagram connect link';
      setError(`${reason} Redirecting to Settings…`);
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current);
      redirectTimer.current = window.setTimeout(() => {
        navigate('/settings?focus=instagram');
      }, 1200);
    }
  }

  async function runDue() {
    setMsg('');
    setError('');
    try {
      const r = await api.post<{ success: boolean; data: unknown[] }>('/api/publish/run-due', {});
      setMsg(JSON.stringify(r.data, null, 2));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to run due publishes');
    }
  }

  async function loadExportPlan() {
    setMsg('');
    setError('');
    setExportPlan(null);
    try {
      const qs = new URLSearchParams({ platform: exportPlatform, videoId: exportVideoId.trim() });
      const r = await api.get<{ success: boolean; data: ExportPlan }>(`/api/publish/export-plan?${qs.toString()}`);
      setExportPlan(r.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate export plan');
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Publishing</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Connect accounts and run scheduled publishes</p>
      </div>

      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-sm font-medium text-red-400">Error</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{error}</p>
          </div>
        )}
        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-3">Connect YouTube</h2>
          <button
            onClick={loadYouTubeConnect}
            className="px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            Generate connect link
          </button>
          {ytUrl && (
            <div className="mt-3 text-sm">
              <a className="text-[hsl(var(--primary))] hover:underline" href={ytUrl} target="_blank" rel="noreferrer">
                Open YouTube OAuth
              </a>
            </div>
          )}
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-3">Connect Instagram (Meta Graph API)</h2>
          <button
            onClick={loadInstagramConnect}
            className="px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            Generate connect link
          </button>
          {igUrl && (
            <div className="mt-3 text-sm">
              <a className="text-[hsl(var(--primary))] hover:underline" href={igUrl} target="_blank" rel="noreferrer">
                Open Meta OAuth
              </a>
            </div>
          )}
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-3">Run due scheduled posts</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">
            In production you typically call this from a cron/CloudWatch schedule.
          </p>
          <button
            onClick={runDue}
            className="px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90"
          >
            Run now
          </button>
          {msg && (
            <pre className="mt-3 text-xs whitespace-pre-wrap rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-3">
              {msg}
            </pre>
          )}
        </section>

        <section className="bg-[hsl(var(--card))] rounded-xl p-6 border border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold mb-3">Export-mode (TikTok / X / Snapchat)</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Video ID</label>
              <input
                value={exportVideoId}
                onChange={(e) => setExportVideoId(e.target.value)}
                placeholder="Paste a Video ID from Video Library"
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Platform</label>
              <select
                value={exportPlatform}
                onChange={(e) => setExportPlatform(e.target.value as 'tiktok' | 'x' | 'snapchat')}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
              >
                <option value="tiktok">TikTok</option>
                <option value="x">X</option>
                <option value="snapchat">Snapchat</option>
              </select>
            </div>
          </div>
          <button
            onClick={loadExportPlan}
            disabled={!exportVideoId.trim()}
            className="mt-3 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
          >
            Generate export checklist
          </button>

          {exportPlan && (
            <div className="mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-3">
              <div className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
                Constraints: {exportPlan.constraints?.aspect || '—'} {exportPlan.constraints?.maxDurationSec ? `• ${exportPlan.constraints.maxDurationSec}s` : ''}
              </div>
              <div className="text-sm font-medium mb-1">Suggested caption</div>
              <pre className="text-xs whitespace-pre-wrap mb-3">{exportPlan.suggestedCaption}</pre>
              <div className="text-sm font-medium mb-1">Checklist</div>
              <ul className="text-xs text-[hsl(var(--muted-foreground))] list-disc pl-5 space-y-1">
                {(exportPlan.checklist || []).map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

