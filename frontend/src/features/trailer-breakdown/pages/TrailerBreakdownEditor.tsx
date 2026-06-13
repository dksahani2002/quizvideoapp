import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, ArrowLeft, RefreshCw, Save, Play, Tv } from 'lucide-react';
import { useUpload } from '../../../api/videos';
import {
  createTrailerBreakdownJob,
  useTrailerJobStatus,
  useTrailerJobResult,
  patchTrailerScript,
  patchTrailerOptions,
  renderTrailerJob,
  retryTrailerJob,
  cancelTrailerJob,
  type BreakdownSegment,
  type TrailerJobOptions,
} from '../api';
import {
  TrailerVoiceSettings,
  DEFAULT_TRAILER_OPTIONS,
} from '../components/TrailerVoiceSettings';
import { friendlyStageLabel } from '../trailerBreakdownUi';
import { friendlyStatusLabel } from '../../../shared/jobs/friendlyLabels';
import { authFetch } from '../../../hooks/useAuthBlob';
import { apiUrlWithTokenForMedia } from '../../../lib/mediaUrl';

function resolvePlayUrl(raw: string): string {
  if (import.meta.env.DEV && raw.startsWith('/')) {
    const apiOrigin =
      (typeof import.meta.env.VITE_API_ORIGIN === 'string' && import.meta.env.VITE_API_ORIGIN.trim()) ||
      'http://127.0.0.1:3000';
    return apiUrlWithTokenForMedia(`${apiOrigin.replace(/\/$/, '')}${raw}`);
  }
  return raw.startsWith('/api/') ? apiUrlWithTokenForMedia(raw) : raw;
}

export function TrailerBreakdownEditor() {
  const { jobId: routeJobId } = useParams<{ jobId: string }>();
  const isNew = routeJobId === 'new';
  const navigate = useNavigate();

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [movieTitle, setMovieTitle] = useState('');
  const [jobId, setJobId] = useState<string | null>(isNew ? null : routeJobId || null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [segments, setSegments] = useState<BreakdownSegment[]>([]);
  const [breakdownTitle, setBreakdownTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [playSrc, setPlaySrc] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [publishError, setPublishError] = useState('');
  const [voiceOptions, setVoiceOptions] = useState<TrailerJobOptions>(DEFAULT_TRAILER_OPTIONS);
  const [savingVoice, setSavingVoice] = useState(false);

  const activeJobId = jobId;
  const uploadYT = useUpload(
    'youtube',
    activeJobId && !isNew ? { trailerBreakdownJobId: activeJobId } : undefined
  );
  const { data: status } = useTrailerJobStatus(activeJobId, !!activeJobId && !isNew);
  const processing = status?.status === 'pending' || status?.status === 'processing';
  const { data: result, refetch: refetchResult } = useTrailerJobResult(
    activeJobId,
    !!activeJobId && !isNew
  );

  useEffect(() => {
    if (result?.breakdownScript?.length) {
      setSegments(result.breakdownScript);
      setBreakdownTitle(result.breakdownTitle || result.movieTitle || '');
      setYoutubeUrl(result.youtubeUrl || '');
      setMovieTitle(result.movieTitle || '');
    }
    if (result?.options) {
      setVoiceOptions({ ...DEFAULT_TRAILER_OPTIONS, ...result.options });
    }
  }, [result]);

  useEffect(() => {
    if (status?.status !== 'completed' || !activeJobId) return;
    authFetch(`/api/trailer-breakdown/${activeJobId}/play`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error('play'))))
      .then((j: { url?: string }) => {
        const raw = typeof j?.url === 'string' ? j.url : null;
        setPlaySrc(raw ? resolvePlayUrl(raw) : null);
      })
      .catch(() => setPlaySrc(null));
    void refetchResult();
  }, [status?.status, activeJobId, refetchResult]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const res = await createTrailerBreakdownJob({
        youtubeUrl: youtubeUrl.trim(),
        movieTitle: movieTitle.trim() || undefined,
        options: voiceOptions,
      });
      const id = res.data?.jobId;
      if (!id) throw new Error('No job ID returned');
      setJobId(id);
      navigate(`/trailer-breakdown/${id}`, { replace: true });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveScript() {
    if (!activeJobId) return;
    setSaving(true);
    setActionMsg('');
    try {
      await patchTrailerScript(activeJobId, segments, breakdownTitle);
      setActionMsg('Script saved.');
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVoice() {
    if (!activeJobId) return;
    setSavingVoice(true);
    setActionMsg('');
    try {
      await patchTrailerOptions(activeJobId, voiceOptions);
      setActionMsg('Voice settings saved. Re-render to apply.');
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Failed to save voice settings');
    } finally {
      setSavingVoice(false);
    }
  }

  async function handleRender() {
    if (!activeJobId) return;
    setRendering(true);
    setActionMsg('');
    try {
      if (!processing) {
        await patchTrailerOptions(activeJobId, voiceOptions);
      }
      await renderTrailerJob(activeJobId);
      setActionMsg('Re-render started.');
      setPlaySrc(null);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Render failed');
    } finally {
      setRendering(false);
    }
  }

  if (isNew || (!activeJobId && isNew)) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <Link
          to="/trailer-breakdown"
          className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={16} />
          Back to library
        </Link>
        <h1 className="text-2xl font-bold">New trailer breakdown</h1>
        <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-[hsl(var(--border))] p-6 bg-[hsl(var(--card))]">
          <div>
            <label className="block text-sm font-medium mb-1">YouTube URL</label>
            <input
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Movie title (optional)</label>
            <input
              type="text"
              placeholder="e.g. Dune: Part Two"
              value={movieTitle}
              onChange={(e) => setMovieTitle(e.target.value)}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            />
          </div>
          <TrailerVoiceSettings options={voiceOptions} onChange={setVoiceOptions} />
          {createError && <p className="text-sm text-[hsl(var(--destructive))]">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {creating ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            Generate breakdown
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link
        to="/trailer-breakdown"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft size={16} />
        Back to library
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{breakdownTitle || 'Trailer breakdown'}</h1>
          {status && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {friendlyStatusLabel(status.status)} —{' '}
              {status.progressMessage || friendlyStageLabel(status.stage)}
              {processing ? ` (${status.progressPercent}%)` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.status === 'completed' && activeJobId && (
            <button
              type="button"
              onClick={() => {
                setPublishError('');
                setActionMsg('');
                uploadYT.mutate(undefined, {
                  onSuccess: (data) => {
                    const y = data?.platforms as
                      | { youtube?: { url?: string; success?: boolean } }
                      | undefined;
                    const u = y?.youtube?.url;
                    setActionMsg(u ? `Published to YouTube: ${u}` : 'Uploaded to YouTube.');
                  },
                  onError: (e) => setPublishError(e instanceof Error ? e.message : String(e)),
                });
              }}
              disabled={uploadYT.isPending || processing}
              className="inline-flex items-center gap-1 rounded-lg bg-red-950/80 border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50"
            >
              {uploadYT.isPending ? <Loader2 className="animate-spin" size={14} /> : <Tv size={14} />}
              YouTube
            </button>
          )}
          {status?.status === 'completed' && activeJobId && (
            <button
              type="button"
              onClick={() => void handleRender()}
              disabled={rendering || processing}
              className="inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-2 text-sm disabled:opacity-50"
            >
              {rendering ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              Re-render video
            </button>
          )}
          {status?.status === 'failed' && activeJobId && (
            <button
              type="button"
              onClick={() => void retryTrailerJob(activeJobId)}
              className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm"
            >
              <RefreshCw size={14} />
              Retry render
            </button>
          )}
          {processing && activeJobId && (
            <button
              type="button"
              onClick={() => void cancelTrailerJob(activeJobId)}
              className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {processing && (
        <div className="rounded-xl border border-[hsl(var(--border))] p-6 bg-[hsl(var(--card))] flex items-center gap-4">
          <Loader2 className="animate-spin shrink-0" size={28} />
          <div className="flex-1">
            <p className="font-medium">{status?.progressMessage || 'Processing…'}</p>
            <div className="mt-2 h-2 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-[width]"
                style={{ width: `${Math.min(100, status?.progressPercent ?? 0)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {playSrc && (
        <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black aspect-video">
          <video src={playSrc} controls className="w-full h-full object-contain" playsInline />
        </div>
      )}

      {!isNew && (
        <div className="space-y-2">
          <TrailerVoiceSettings
            options={voiceOptions}
            onChange={setVoiceOptions}
            disabled={processing}
          />
          {!processing && (
            <button
              type="button"
              onClick={() => void handleSaveVoice()}
              disabled={savingVoice}
              className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm disabled:opacity-50"
            >
              {savingVoice ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Save voice settings
            </button>
          )}
        </div>
      )}

      {segments.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Breakdown script</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveScript()}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                Save script
              </button>
              <button
                type="button"
                onClick={() => void handleRender()}
                disabled={rendering || processing}
                className="inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-2 text-sm disabled:opacity-50"
              >
                {rendering ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                Re-render video
              </button>
            </div>
          </div>
          {actionMsg && <p className="text-sm text-[hsl(var(--muted-foreground))]">{actionMsg}</p>}
          <div className="space-y-3">
            {segments.map((seg, i) => (
              <div
                key={seg.id}
                className="rounded-xl border border-[hsl(var(--border))] p-4 bg-[hsl(var(--card))] space-y-2"
              >
                <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <span>#{i + 1}</span>
                  <span>
                    {seg.startSec.toFixed(1)}s – {seg.endSec.toFixed(1)}s
                  </span>
                </div>
                <input
                  value={seg.label}
                  onChange={(e) => {
                    const next = [...segments];
                    next[i] = { ...seg, label: e.target.value };
                    setSegments(next);
                  }}
                  className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm font-medium"
                  placeholder="Label"
                />
                <textarea
                  value={seg.narration}
                  onChange={(e) => {
                    const next = [...segments];
                    next[i] = { ...seg, narration: e.target.value };
                    setSegments(next);
                  }}
                  rows={3}
                  className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                  placeholder="Narration"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {publishError && (
        <p className="text-sm text-[hsl(var(--destructive))]">{publishError}</p>
      )}

      {status?.error && status.status === 'failed' && (
        <p className="text-sm text-[hsl(var(--destructive))]">{status.error}</p>
      )}
    </div>
  );
}
