import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Tv, Loader2, Clapperboard, Undo2, Redo2 } from 'lucide-react';
import {
  createStoryVideoJob,
  getStoryVideoStatus,
  getStoryVideoResult,
  editStoryVideo,
  cancelStoryVideoJob,
  retryStoryVideoJob,
  uploadStoryAssetWithPresignOrLocal,
  type StoryClip,
  type StoryJobOptions,
  type SceneInfo,
} from '../api';
import { useUpload } from '../../../api/videos';
import { authFetch } from '../../../hooks/useAuthBlob';
import { TimelineEditor, ClipInspectorPanel } from '../components/TimelineEditor';
import { StoryProgramPreview } from '../components/StoryProgramPreview';
import { activeClipImageOverlayAtTime } from '../components/storyPreviewOverlay';
import { programStartSecForClipIndex } from '../components/storyTimelineUtils';
import { apiUrlWithTokenForMedia } from '../../../lib/mediaUrl';
import { useStoryTimelineHistory } from '../hooks/useStoryTimelineHistory';
import {
  FormSection,
  InputModeTabs,
  StoryPhaseStepper,
  friendlyStageLabel,
  friendlyStatusLabel,
} from '../storyVideoUi';
import { VoiceSettingsPanel } from '../../../shared/voice/VoiceSettingsPanel';
import type { VoiceOptions } from '../../../shared/voice/types';

const DEFAULT_OPTIONS: StoryJobOptions = {
  sceneDetectionMode: 'hybrid',
  subtitleMode: 'both',
  bgmVolume: 0.14,
  exportPreset: 'balanced',
  narrationLanguage: 'en',
  ttsProvider: 'inherit',
  pySceneThreshold: 27,
  ffmpegSceneThreshold: 0.32,
  narrationSceneMatchMode: 'embeddings',
  translateToEnglish: true,
};

/** Default filenames under `backend/assets/` for local dev (override with VITE_STORY_DEV_*). */
const DEFAULT_LOCAL_DEV_VIDEO =
  'S01E04 When Life Gives You Tangerines [1080p] [Multi Sub].mkv';
const DEFAULT_LOCAL_DEV_AUDIO = 'AUDIO-2026-04-09-22-39-06.m4a';

type Phase = 'upload' | 'processing' | 'editor';

function readInitialJobIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const j = new URLSearchParams(window.location.search).get('jobId')?.trim();
  return j || null;
}

export function StoryVideoEditor() {
  const [, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>(() => (readInitialJobIdFromUrl() ? 'processing' : 'upload'));
  const [jobId, setJobId] = useState<string | null>(() => readInitialJobIdFromUrl());
  const [status, setStatus] = useState<string>('');
  const [stage, setStage] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string>('');
  const {
    timeline,
    canUndo,
    canRedo,
    applyTimeline,
    applyTimelineFn,
    replaceTimeline,
    undo: undoTimeline,
    redo: redoTimeline,
  } = useStoryTimelineHistory();
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [outputUrl, setOutputUrl] = useState<string>('');
  const [outputSrtUrl, setOutputSrtUrl] = useState<string>('');
  const [jobOptions, setJobOptions] = useState<StoryJobOptions>(DEFAULT_OPTIONS);
  const [detectedLanguages, setDetectedLanguages] = useState<{ video?: string; narration?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  /** Optional presigned GET URLs (https) — upload to S3 first, paste link; do not use with the matching file field */
  const [videoUrl, setVideoUrl] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [bgmSourceUrl, setBgmSourceUrl] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [options, setOptions] = useState<StoryJobOptions>(DEFAULT_OPTIONS);
  /** Dev: paths relative to backend/assets/ (sent as devVideoAsset / devAudioAsset). */
  const [devVideoAsset, setDevVideoAsset] = useState('');
  const [devAudioAsset, setDevAudioAsset] = useState('');
  const [downloadingMp4, setDownloadingMp4] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  /** Bumped after each successful export fetch so the <video> reloads (avoids showing a cached older edit). */
  const [videoCacheBust, setVideoCacheBust] = useState(0);
  /** Hide player while a new re-render is running so we don’t flash the previous MP4 from the same URL. */
  const [previewBlocked, setPreviewBlocked] = useState(false);
  /** Set when <video> fails to decode (wrong proxy port, 404, missing token). */
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [selectedClipIndex, setSelectedClipIndex] = useState<number | null>(null);
  const [programTimeSec, setProgramTimeSec] = useState(0);
  const [programDurationSec, setProgramDurationSec] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [videoInputMode, setVideoInputMode] = useState<'file' | 'url'>('file');
  const [audioInputMode, setAudioInputMode] = useState<'file' | 'url'>('file');
  const [bgmInputMode, setBgmInputMode] = useState<'none' | 'file' | 'url'>('none');

  const uploadYT = useUpload('youtube', jobId || undefined);
  const uploadIG = useUpload('instagram', jobId || undefined);

  const devVideoName =
    (import.meta.env.VITE_STORY_DEV_VIDEO_ASSET as string | undefined)?.trim() || DEFAULT_LOCAL_DEV_VIDEO;
  const devAudioName =
    (import.meta.env.VITE_STORY_DEV_AUDIO_ASSET as string | undefined)?.trim() || DEFAULT_LOCAL_DEV_AUDIO;

  const optionsJson = useMemo(() => JSON.stringify(options), [options]);

  /** Play URL: prefer API field; if missing, try on-disk route (some dev DB rows omit `outputVideoUrl`). */
  const playUrl = useMemo(() => {
    if (previewBlocked) return '';
    if (outputUrl.trim()) return outputUrl.trim();
    if (jobId) return `/api/story-video/files/${jobId}/output.mp4`;
    return '';
  }, [outputUrl, jobId, previewBlocked]);

  const seekProgram = useCallback((sec: number) => {
    const v = previewVideoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : sec + 1;
    v.currentTime = Math.max(0, Math.min(sec, d));
  }, []);

  useEffect(() => {
    const n = timeline.clips?.length ?? 0;
    if (selectedClipIndex != null && (selectedClipIndex < 0 || selectedClipIndex >= n)) {
      setSelectedClipIndex(null);
    }
  }, [timeline.clips, selectedClipIndex]);

  const updateSelectedClip = useCallback(
    (patch: Partial<StoryClip>) => {
      if (selectedClipIndex == null) return;
      applyTimelineFn((t) => {
        const clips = t.clips || [];
        return {
          ...t,
          clips: clips.map((c, i) => {
            if (i !== selectedClipIndex) return c;
            const merged: StoryClip = { ...c, ...patch };
            for (const key of Object.keys(patch) as (keyof StoryClip)[]) {
              if (patch[key] === undefined) {
                delete (merged as Record<string, unknown>)[key as string];
              }
            }
            return merged;
          }),
        };
      });
    },
    [selectedClipIndex, applyTimelineFn]
  );

  const applySceneToSelectedClip = useCallback(
    (sceneIndex: number) => {
      if (selectedClipIndex == null) return;
      const s = scenes[sceneIndex];
      if (!s) return;
      updateSelectedClip({ start: s.start, end: s.end, sceneIndex });
    },
    [selectedClipIndex, scenes, updateSelectedClip]
  );

  const clipProgramStartSec = useMemo(() => {
    if (selectedClipIndex == null) return 0;
    return programStartSecForClipIndex(timeline.clips || [], selectedClipIndex);
  }, [selectedClipIndex, timeline.clips]);

  const previewActiveImageOverlay = useMemo(
    () => activeClipImageOverlayAtTime(timeline.clips || [], programTimeSec),
    [timeline.clips, programTimeSec]
  );

  const togglePreviewPlay = useCallback(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  useEffect(() => {
    setVideoLoadError(null);
  }, [playUrl, videoCacheBust]);

  useEffect(() => {
    if (phase !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoTimeline();
        else undoTimeline();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoTimeline();
        return;
      }
      if (e.code !== 'Space') return;
      e.preventDefault();
      const v = previewVideoRef.current;
      if (!v || previewBlocked || !playUrl) return;
      if (v.paused) void v.play();
      else v.pause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, previewBlocked, playUrl, undoTimeline, redoTimeline]);

  /** Keep ?jobId= in sync so refresh preserves the job and the preview can load again. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get('jobId');
    if (jobId) {
      if (current !== jobId) {
        params.set('jobId', jobId);
        setSearchParams(params, { replace: true });
      }
    } else if (current) {
      params.delete('jobId');
      setSearchParams(params, { replace: true });
    }
  }, [jobId, setSearchParams]);

  const poll = useCallback(async (id: string) => {
    try {
      const s = await getStoryVideoStatus(id);
      const d = s.data;
      setStatus(d.status);
      setStage(d.stage);
      setMessage(d.progressMessage);
      setProgressPercent(d.progressPercent ?? 0);
      setAttempts(d.attempts ?? 0);
      setMaxAttempts(d.maxAttempts ?? 3);
      if (d.error) setError(d.error);
      if (d.status === 'completed') {
        const r = await getStoryVideoResult(id);
        replaceTimeline(r.data.timeline || { clips: [] });
        setOutputUrl(r.data.outputVideoUrl || '');
        setOutputSrtUrl(r.data.outputSrtUrl || '');
        setScenes(Array.isArray(r.data.scenes) ? (r.data.scenes as SceneInfo[]) : []);
        if (r.data.options) setJobOptions({ ...DEFAULT_OPTIONS, ...r.data.options });
        setDetectedLanguages(r.data.detectedLanguages || {});
        setVideoCacheBust((n) => n + 1);
        setPreviewBlocked(false);
        setPhase('editor');
        return true;
      }
      if (d.status === 'failed' || d.status === 'cancelled') {
        setPhase('upload');
        return true;
      }
      return false;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('upload');
      return true;
    }
  }, [replaceTimeline]);

  useEffect(() => {
    if (!jobId || phase !== 'processing') return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !jobId) return;
      const done = await poll(jobId);
      if (!done && !cancelled) {
        window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [jobId, phase, poll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const isProd = import.meta.env.PROD;
    const vUrl = videoUrl.trim();
    const aUrl = audioUrl.trim();
    const bgmUrl = bgmSourceUrl.trim();
    const dv = devVideoAsset.trim();
    const da = devAudioAsset.trim();

    if (isProd && (dv || da)) {
      setError(
        'Local server assets are not used in production. Upload files to S3 and paste presigned GET URLs (or s3:// URIs).'
      );
      return;
    }
    if (isProd && (videoFile || audioFile || bgmFile)) {
      setError(
        'In production, upload each file with “Upload to S3 → fills URL” (or paste presigned URLs), then submit—do not send raw files to the API.'
      );
      return;
    }

    if (!videoFile && !vUrl && !dv) {
      setError(
        isProd
          ? 'Provide a video presigned HTTPS URL or s3:// URI (upload to your bucket first if needed).'
          : 'Choose a video file, paste a video URL, or use dev server assets (below).'
      );
      return;
    }
    if (videoFile && vUrl) {
      setError('Use either a video file or a video URL, not both.');
      return;
    }
    if (dv && (videoFile || vUrl)) {
      setError('Use either dev video asset paths or file/URL, not both.');
      return;
    }
    if (!scriptText.trim() && !audioFile && !aUrl && !da) {
      setError(
        isProd
          ? 'Add a narration script or a presigned narration audio URL (or s3://).'
          : 'Add a narration script, an audio file, an audio URL, or dev narration asset.'
      );
      return;
    }
    if (audioFile && aUrl) {
      setError('Use either narration audio file or audio URL, not both.');
      return;
    }
    if (da && (audioFile || aUrl)) {
      setError('Use either dev audio asset or file/URL, not both.');
      return;
    }
    if (bgmFile && bgmUrl) {
      setError('Use either BGM file or BGM URL, not both.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (dv) fd.append('devVideoAsset', dv);
      else if (vUrl) fd.append('videoUrl', vUrl);
      else if (videoFile) fd.append('video', videoFile);
      if (da) fd.append('devAudioAsset', da);
      else if (aUrl) fd.append('audioUrl', aUrl);
      else if (audioFile) fd.append('audio', audioFile);
      if (bgmUrl) fd.append('bgmSourceUrl', bgmUrl);
      else if (bgmFile) fd.append('bgm', bgmFile);
      if (scriptText.trim()) fd.append('scriptText', scriptText.trim());
      fd.append('options', optionsJson);
      const res = await createStoryVideoJob(fd, crypto.randomUUID());
      setJobId(res.data.jobId);
      setJobOptions(res.data.options || options);
      if (res.data.status === 'completed') {
        const r = await getStoryVideoResult(res.data.jobId);
        replaceTimeline(r.data.timeline || { clips: [] });
        setOutputUrl(r.data.outputVideoUrl || '');
        setOutputSrtUrl(r.data.outputSrtUrl || '');
        setScenes(Array.isArray(r.data.scenes) ? (r.data.scenes as SceneInfo[]) : []);
        if (r.data.options) setJobOptions({ ...DEFAULT_OPTIONS, ...r.data.options });
        setDetectedLanguages(r.data.detectedLanguages || {});
        setVideoCacheBust((n) => n + 1);
        setPreviewBlocked(false);
        setPhase('editor');
        setError('');
        return;
      }
      setPhase('processing');
      setStatus(res.data.status);
      setMessage(res.data.idempotentReplay ? 'Resuming existing job…' : 'Queued…');
      setProgressPercent(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadChosenFileToS3(kind: 'video' | 'audio' | 'bgm') {
    const file = kind === 'video' ? videoFile : kind === 'audio' ? audioFile : bgmFile;
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { getUrl } = await uploadStoryAssetWithPresignOrLocal(file, {
        kind,
        filename: file.name,
        contentType: file.type || undefined,
      });
      if (kind === 'video') {
        setVideoUrl(getUrl);
        setVideoFile(null);
      } else if (kind === 'audio') {
        setAudioUrl(getUrl);
        setAudioFile(null);
      } else {
        setBgmSourceUrl(getUrl);
        setBgmFile(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!jobId) return;
    try {
      await cancelStoryVideoJob(jobId);
      setMessage('Cancelling…');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRetry() {
    if (!jobId) return;
    setError('');
    setSubmitting(true);
    try {
      await retryStoryVideoJob(jobId);
      setPhase('processing');
      setStatus('pending');
      setMessage('Queued for retry…');
      setProgressPercent(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const refreshOutputUrls = useCallback(async () => {
    if (!jobId) return;
    try {
      const r = await getStoryVideoResult(jobId);
      replaceTimeline(r.data.timeline || { clips: [] });
      setOutputUrl(r.data.outputVideoUrl || '');
      setOutputSrtUrl(r.data.outputSrtUrl || '');
      setScenes(Array.isArray(r.data.scenes) ? (r.data.scenes as SceneInfo[]) : []);
      if (r.data.options) setJobOptions({ ...DEFAULT_OPTIONS, ...r.data.options });
      setDetectedLanguages(r.data.detectedLanguages || {});
      setVideoCacheBust((n) => n + 1);
      setPreviewBlocked(false);
    } catch {
      setError('Could not load output URLs');
    }
  }, [jobId, replaceTimeline]);

  async function handleDownloadMp4() {
    if (!jobId) return;
    setPublishMessage('');
    setDownloadingMp4(true);
    try {
      const res = await authFetch(`/api/story-video/files/${jobId}/output.mp4`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `story-${jobId}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download MP4 (is the output on this server or S3?)');
    } finally {
      setDownloadingMp4(false);
    }
  }

  async function downloadSrt() {
    if (!jobId) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/story-video/${jobId}/subtitles.srt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError('Could not download subtitles');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-${jobId}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveRender() {
    if (!jobId) return;
    setRendering(true);
    setError('');
    try {
      const r = await editStoryVideo(jobId, { timeline, render: true });
      if (r.data.asyncRerender) {
        setPhase('processing');
        setStatus('processing');
        setStage('re_render');
        setMessage(
          'Re-rendering timeline in the background (many clips can take a long time). Progress updates below…'
        );
        setProgressPercent(0);
        setOutputUrl('');
        setPreviewBlocked(true);
        return;
      }
      setOutputUrl(r.data.outputVideoUrl || '');
      setOutputSrtUrl(r.data.outputSrtUrl || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  async function handleSaveOnly() {
    if (!jobId) return;
    setRendering(true);
    setError('');
    try {
      await editStoryVideo(jobId, { timeline, render: false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  return (
    <div
      className={`mx-auto space-y-6 ${phase === 'editor' ? 'max-w-[min(1680px,calc(100vw-2rem))] w-full' : 'max-w-3xl'}`}
    >
      {phase !== 'editor' && <StoryPhaseStepper phase={phase} />}

      {phase !== 'editor' && (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              {phase === 'processing' ? 'Building your story video' : 'Create story video'}
            </h1>
            <Link
              to="/story-videos"
              className="text-sm font-medium text-[hsl(var(--primary))] hover:underline shrink-0"
            >
              Story library
            </Link>
          </div>
          {phase === 'upload' && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
              Upload source footage and narration. The app detects scenes, aligns your script or voiceover, and opens
              an editor when the first cut is ready.
            </p>
          )}
          {phase === 'upload' && import.meta.env.PROD && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 leading-relaxed">
              In production, upload files to S3 first, then paste a <strong>presigned GET URL</strong> (the long link
              with query parameters) or an <code className="text-[11px]">s3://bucket/key</code> path the server can read.
            </p>
          )}
        </div>
      )}

      {phase === 'upload' && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
        >
          {jobId && (status === 'failed' || status === 'cancelled') && (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3 space-y-2">
              <p className="text-sm font-medium">
                Previous job {status === 'cancelled' ? 'was cancelled' : 'failed'}
              </p>
              {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  disabled={submitting}
                  className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Retry job
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJobId(null);
                    setStatus('');
                    setError('');
                    setStage('');
                    setMessage('');
                  }}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm"
                >
                  Start fresh
                </button>
              </div>
            </div>
          )}

          {import.meta.env.DEV && (
            <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-4 py-3 space-y-2">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Local dev shortcut</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Load test files from <code className="text-[11px]">backend/assets/</code> without uploading.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-amber-700"
                  onClick={() => {
                    setDevVideoAsset(devVideoName);
                    setDevAudioAsset(devAudioName);
                    setVideoFile(null);
                    setVideoUrl('');
                    setAudioFile(null);
                    setAudioUrl('');
                    setVideoInputMode('file');
                    setAudioInputMode('file');
                  }}
                >
                  Use test video + audio
                </button>
                {(devVideoAsset || devAudioAsset) && (
                  <button
                    type="button"
                    className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm"
                    onClick={() => {
                      setDevVideoAsset('');
                      setDevAudioAsset('');
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {(devVideoAsset || devAudioAsset) && (
                <p className="text-xs font-mono text-[hsl(var(--muted-foreground))] break-all">
                  {devVideoAsset || '—'} · {devAudioAsset || '—'}
                </p>
              )}
            </div>
          )}

          <FormSection
            title="Source video"
            description="The footage to cut scenes from. Required unless using the dev shortcut above."
          >
            <InputModeTabs
              value={videoInputMode}
              onChange={(mode) => {
                setVideoInputMode(mode);
                if (mode === 'file') {
                  setVideoUrl('');
                  setDevVideoAsset('');
                } else {
                  setVideoFile(null);
                  setDevVideoAsset('');
                }
              }}
              disabled={!!devVideoAsset.trim()}
              options={[
                { value: 'file', label: 'Upload file' },
                { value: 'url', label: 'Paste URL' },
              ]}
            />
            {videoInputMode === 'file' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="video/*"
                  className="text-sm"
                  disabled={!!devVideoAsset.trim()}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setVideoFile(f);
                    if (f) setDevVideoAsset('');
                  }}
                />
                {import.meta.env.PROD && (
                  <button
                    type="button"
                    disabled={submitting || !videoFile || !!devVideoAsset.trim()}
                    onClick={() => void uploadChosenFileToS3('video')}
                    className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Upload to S3 → fill URL
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono"
                  placeholder="Presigned https URL or s3://bucket/key"
                  value={videoUrl}
                  disabled={!!devVideoAsset.trim()}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    if (e.target.value.trim()) {
                      setVideoFile(null);
                      setDevVideoAsset('');
                    }
                  }}
                />
                <details className="text-xs text-[hsl(var(--muted-foreground))]">
                  <summary className="cursor-pointer hover:text-[hsl(var(--foreground))]">How to get a valid URL</summary>
                  <p className="mt-2 leading-relaxed">
                    Use a presigned GET link (includes <code className="text-[11px]">?X-Amz-…</code> query params), not
                    the short console object URL. Or use <code className="text-[11px]">s3://bucket/path</code> if the API
                    server has read access.
                  </p>
                </details>
              </div>
            )}
          </FormSection>

          <FormSection
            title="Narration"
            description="Provide a voice recording, a URL, and/or a script. At least one is required."
          >
            <InputModeTabs
              value={audioInputMode}
              onChange={(mode) => {
                setAudioInputMode(mode);
                if (mode === 'file') {
                  setAudioUrl('');
                  setDevAudioAsset('');
                } else {
                  setAudioFile(null);
                  setDevAudioAsset('');
                }
              }}
              disabled={!!devAudioAsset.trim()}
              options={[
                { value: 'file', label: 'Audio file' },
                { value: 'url', label: 'Audio URL' },
              ]}
            />
            {audioInputMode === 'file' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  className="text-sm"
                  disabled={!!devAudioAsset.trim()}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setAudioFile(f);
                    if (f) setDevAudioAsset('');
                  }}
                />
                {import.meta.env.PROD && (
                  <button
                    type="button"
                    disabled={submitting || !audioFile || !!devAudioAsset.trim()}
                    onClick={() => void uploadChosenFileToS3('audio')}
                    className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Upload to S3 → fill URL
                  </button>
                )}
              </div>
            ) : (
              <input
                type="text"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono"
                placeholder="Presigned https URL or s3://bucket/key"
                value={audioUrl}
                disabled={!!devAudioAsset.trim()}
                onChange={(e) => {
                  setAudioUrl(e.target.value);
                  if (e.target.value.trim()) {
                    setAudioFile(null);
                    setDevAudioAsset('');
                  }
                }}
              />
            )}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
                Script text {audioFile || audioUrl.trim() || devAudioAsset ? '(optional — improves alignment)' : '(or use instead of audio for text-to-speech)'}
              </label>
              <textarea
                className="w-full min-h-[100px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                placeholder="Paste your narration script here…"
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
              />
            </div>
          </FormSection>

          <FormSection title="Background music" description="Quiet track mixed under the voice." optional>
            <InputModeTabs
              value={bgmInputMode}
              onChange={(mode) => {
                setBgmInputMode(mode);
                if (mode === 'none') {
                  setBgmFile(null);
                  setBgmSourceUrl('');
                } else if (mode === 'file') {
                  setBgmSourceUrl('');
                } else {
                  setBgmFile(null);
                }
              }}
              options={[
                { value: 'none', label: 'None' },
                { value: 'file', label: 'Audio file' },
                { value: 'url', label: 'Audio URL' },
              ]}
            />
            {bgmInputMode === 'file' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  className="text-sm"
                  onChange={(e) => setBgmFile(e.target.files?.[0] || null)}
                />
                {import.meta.env.PROD && (
                  <button
                    type="button"
                    disabled={submitting || !bgmFile}
                    onClick={() => void uploadChosenFileToS3('bgm')}
                    className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Upload to S3 → fill URL
                  </button>
                )}
              </div>
            )}
            {bgmInputMode === 'url' && (
              <input
                type="text"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono"
                placeholder="Presigned https URL or s3://bucket/key"
                value={bgmSourceUrl}
                onChange={(e) => {
                  setBgmSourceUrl(e.target.value);
                  if (e.target.value.trim()) setBgmFile(null);
                }}
              />
            )}
          </FormSection>

          <details className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 px-4 py-3 group">
            <summary className="cursor-pointer text-sm font-medium text-[hsl(var(--foreground))] list-none flex items-center justify-between">
              Advanced options
              <span className="text-xs font-normal text-[hsl(var(--muted-foreground))] group-open:hidden">Scene detection, subtitles, export…</span>
            </summary>
            <div className="grid sm:grid-cols-2 gap-4 pt-4 mt-2 border-t border-[hsl(var(--border))]">
            <label className="text-sm">
              <span className="font-medium block mb-1">Scene detection</span>
              <select
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-background px-2 py-2 text-sm"
                value={options.sceneDetectionMode}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    sceneDetectionMode: e.target.value as StoryJobOptions['sceneDetectionMode'],
                  }))
                }
              >
                <option value="ffmpeg">FFmpeg (fast)</option>
                <option value="pyscenedetect">PySceneDetect (CLI, if installed)</option>
                <option value="hybrid">Hybrid (recommended)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium block mb-1">Subtitles</span>
              <select
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-background px-2 py-2 text-sm"
                value={options.subtitleMode}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, subtitleMode: e.target.value as StoryJobOptions['subtitleMode'] }))
                }
              >
                <option value="none">None</option>
                <option value="burn_in">Burn-in only</option>
                <option value="sidecar_srt">SRT file only</option>
                <option value="both">Burn-in + SRT</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium block mb-1">Export quality</span>
              <select
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-background px-2 py-2 text-sm"
                value={options.exportPreset}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, exportPreset: e.target.value as StoryJobOptions['exportPreset'] }))
                }
              >
                <option value="fast">Fast (smaller files)</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality (larger files)</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <VoiceSettingsPanel
                allowInherit
                allowSystem={false}
                reRenderHint={false}
                previewText="This is a preview of the story narration voice."
                value={{
                  ttsProvider: options.ttsProvider,
                  ttsVoice: '',
                  ttsModel: 'tts-1',
                  systemVoice: '',
                  elevenlabsModelId: '',
                  narrationLanguage: options.narrationLanguage,
                }}
                onChange={(voice: VoiceOptions) =>
                  setOptions((o) => ({
                    ...o,
                    ttsProvider: voice.ttsProvider as StoryJobOptions['ttsProvider'],
                    narrationLanguage: voice.narrationLanguage,
                  }))
                }
              />
            </div>
            <label className="text-sm flex items-center gap-2 col-span-2">
              <input
                type="checkbox"
                className="rounded border border-[hsl(var(--border))]"
                checked={options.translateToEnglish}
                onChange={(e) => setOptions((o) => ({ ...o, translateToEnglish: e.target.checked }))}
              />
              <span>
                Translate scene + narration text to English (recommended for mixed-language sources)
              </span>
            </label>
            <label className="text-sm">
              <span className="font-medium block mb-1">Narration ↔ scenes</span>
              <select
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-background px-2 py-2 text-sm"
                value={options.narrationSceneMatchMode}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    narrationSceneMatchMode: e.target.value as StoryJobOptions['narrationSceneMatchMode'],
                  }))
                }
              >
                <option value="embeddings">By text similarity (same language as video)</option>
                <option value="sequential">In order along the video (different language VO)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium block mb-1">BGM volume (under voice)</span>
              <input
                type="number"
                min={0}
                max={0.35}
                step={0.02}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-background px-2 py-2 text-sm"
                value={options.bgmVolume}
                onChange={(e) => setOptions((o) => ({ ...o, bgmVolume: parseFloat(e.target.value) || 0 }))}
              />
            </label>
            </div>
          </details>

          {error && !(jobId && (status === 'failed' || status === 'cancelled')) && (
            <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-6 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Start processing'}
          </button>
        </form>
      )}

      {phase === 'processing' && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-5">
          <div className="space-y-1">
            <p className="text-lg font-medium text-[hsl(var(--foreground))]">
              {message || 'Starting…'}
            </p>
            {stage && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {friendlyStageLabel(stage)}
                {status ? ` · ${friendlyStatusLabel(status)}` : ''}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>{Math.min(100, progressPercent)}% complete</span>
              {maxAttempts > 1 && (
                <span>
                  Attempt {attempts}/{maxAttempts}
                </span>
              )}
            </div>
            <div className="h-2.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-[width] duration-300"
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
          </div>
          {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
          {jobId && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm hover:bg-[hsl(var(--secondary))]"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {phase === 'editor' && (
        <div className="space-y-4">
          <StoryPhaseStepper phase={phase} />

          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            <p className="font-medium text-[hsl(var(--foreground))] mb-1">How to edit</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs sm:text-sm">
              <li>Scrub the timeline or click a clip to select it</li>
              <li>Adjust timing and overlays in the panel on the right</li>
              <li>Click <strong className="text-[hsl(var(--foreground))]">Export</strong> to rebuild the video after changes</li>
            </ul>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden flex flex-col min-h-[min(88dvh,920px)] h-[min(88dvh,920px)]">
            <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/90">
              <div className="flex items-center gap-2 min-w-0 mr-auto">
                <Clapperboard className="text-cyan-400 shrink-0" size={20} />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-100 truncate">Story edit</h2>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">
                    {jobId ? jobId : '—'}
                    {(detectedLanguages.video || detectedLanguages.narration) && (
                      <span className="text-zinc-600 ml-2">
                        · {detectedLanguages.video || '—'} / {detectedLanguages.narration || '—'}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {jobId && (
                  <button
                    type="button"
                    onClick={() => void refreshOutputUrls()}
                    className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    Refresh preview
                  </button>
                )}
                {playUrl && (
                  <a
                    href={apiUrlWithTokenForMedia(playUrl, videoCacheBust)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                  >
                    Pop out
                  </a>
                )}
                <button
                  type="button"
                  onClick={undoTimeline}
                  disabled={!canUndo || rendering}
                  title="Undo (⌘/Ctrl+Z)"
                  className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
                  aria-label="Undo timeline"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={redoTimeline}
                  disabled={!canRedo || rendering}
                  title="Redo (⌘/Ctrl+Shift+Z or Ctrl+Y)"
                  className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
                  aria-label="Redo timeline"
                >
                  <Redo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleSaveOnly}
                  disabled={rendering}
                  title="Save timeline without re-rendering"
                  className="rounded-md border border-zinc-600 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={handleSaveRender}
                  disabled={rendering}
                  className="rounded-md bg-cyan-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-cyan-500 disabled:opacity-50"
                >
                  {rendering ? 'Exporting…' : 'Export video'}
                </button>
                {(outputSrtUrl || jobOptions.subtitleMode !== 'none') && (
                  <button
                    type="button"
                    onClick={() =>
                      outputSrtUrl ? window.open(apiUrlWithTokenForMedia(outputSrtUrl), '_blank') : downloadSrt()
                    }
                    title="Download subtitle file"
                    className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Subtitles
                  </button>
                )}
                {jobId && playUrl && !previewBlocked && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDownloadMp4()}
                      disabled={downloadingMp4}
                      className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {downloadingMp4 ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setPublishMessage('');
                        uploadYT.mutate(undefined, {
                          onSuccess: (data) => {
                            const y = data?.platforms as
                              | { youtube?: { url?: string; success?: boolean } }
                              | undefined;
                            const u = y?.youtube?.url;
                            setPublishMessage(u ? `YouTube: ${u}` : 'Uploaded to YouTube.');
                          },
                          onError: (e) => setError(e instanceof Error ? e.message : String(e)),
                        });
                      }}
                      disabled={uploadYT.isPending}
                      className="rounded-md bg-red-950/80 border border-red-900 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {uploadYT.isPending ? <Loader2 size={12} className="animate-spin" /> : <Tv size={12} />}
                      YouTube
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        uploadIG.mutate(undefined, {
                          onError: (e) => setError(e instanceof Error ? e.message : String(e)),
                        });
                      }}
                      disabled={uploadIG.isPending}
                      title="Use Publishing page for Instagram"
                      className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-500 disabled:opacity-50"
                    >
                      Instagram
                    </button>
                  </>
                )}
                <Link
                  to="/story-videos"
                  className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                >
                  Library
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setPhase('upload');
                    setJobId(null);
                    setSelectedClipIndex(null);
                    replaceTimeline({ clips: [] });
                    setScenes([]);
                    setOutputUrl('');
                    setOutputSrtUrl('');
                    setDetectedLanguages({});
                    setError('');
                  }}
                  className="rounded-md text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1.5"
                >
                  New job
                </button>
              </div>
            </header>

            {publishMessage && (
              <p className="text-[11px] text-zinc-500 px-3 py-1 border-b border-zinc-800 bg-zinc-900/50 wrap-break-word">
                {publishMessage}
              </p>
            )}

            <div className="flex-1 flex flex-col lg:flex-row min-h-0">
              <div className="flex-1 flex flex-col min-w-0 min-h-[280px] lg:min-h-0 border-b lg:border-b-0 lg:border-r border-zinc-800">
                <StoryProgramPreview
                  playUrl={playUrl}
                  videoCacheBust={videoCacheBust}
                  previewBlocked={previewBlocked}
                  videoRef={previewVideoRef}
                  overlay={previewActiveImageOverlay}
                  programTimeSec={programTimeSec}
                  programDurationSec={programDurationSec}
                  previewPlaying={previewPlaying}
                  videoLoadError={videoLoadError}
                  onProgramTimeSec={setProgramTimeSec}
                  onProgramDurationSec={setProgramDurationSec}
                  onPreviewPlaying={setPreviewPlaying}
                  onVideoLoadError={setVideoLoadError}
                  onTogglePlay={togglePreviewPlay}
                />
              </div>

              <aside className="w-full lg:w-[min(100%,380px)] lg:max-w-[380px] shrink-0 bg-zinc-900 overflow-y-auto max-h-[40vh] lg:max-h-none border-t lg:border-t-0 border-zinc-800">
                <ClipInspectorPanel
                  jobId={jobId}
                  clip={
                    selectedClipIndex != null ? (timeline.clips || [])[selectedClipIndex] ?? null : null
                  }
                  clipIndex={selectedClipIndex ?? 0}
                  clipProgramStartSec={clipProgramStartSec}
                  scenes={scenes}
                  disabled={rendering}
                  onUpdate={updateSelectedClip}
                  onApplyScene={applySceneToSelectedClip}
                />
              </aside>
            </div>

            <TimelineEditor
              timeline={timeline}
              onChange={applyTimeline}
              disabled={rendering}
              selectedClipIndex={selectedClipIndex}
              onSelectClip={setSelectedClipIndex}
              programTimeSec={programTimeSec}
              programDurationSec={programDurationSec}
              onSeekProgram={seekProgram}
            />
          </div>

          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Export settings: {jobOptions.exportPreset} quality, {jobOptions.subtitleMode.replace(/_/g, ' ')} subtitles.
            Instagram uploads: use{' '}
            <Link to="/publishing" className="underline">
              Publishing
            </Link>
            .
          </p>
          {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
        </div>
      )}
    </div>
  );
}
