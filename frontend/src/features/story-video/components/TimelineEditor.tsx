import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ImagePlus, Scissors, ZoomIn, ZoomOut } from 'lucide-react';
import {
  uploadStoryAssetWithPresignOrLocal,
  type StoryClip,
  type StoryTimeline,
  type SceneInfo,
  type StoryEditorImageAsset,
} from '../api';
import { cn } from '../../lib/utils';
import { apiUrlWithTokenForMedia } from '../../lib/mediaUrl';
import {
  clipOutputDurationSec,
  formatTimecode,
  programStartSecForClipIndex,
  totalProgramDurationSec,
} from './storyTimelineUtils';

const SOURCE_PREVIEW_SIZE_KEY = 'storyVideoSourcePreviewSize';

const SOURCE_PREVIEW_SIZES = {
  regular: { w: 180, h: 102, label: 'Regular' },
  medium: { w: 280, h: 158, label: 'Medium' },
  large: { w: 400, h: 225, label: 'Large' },
} as const;

type SourcePreviewSize = keyof typeof SOURCE_PREVIEW_SIZES;

function readStoredPreviewSize(): SourcePreviewSize {
  try {
    const v = localStorage.getItem(SOURCE_PREVIEW_SIZE_KEY);
    if (v === 'medium' || v === 'large' || v === 'regular') return v;
  } catch {
    /* ignore */
  }
  return 'regular';
}

const SOURCE_SKIP_STEPS = [1, 2, 5, 10, 60] as const;

function formatSkipLabel(sec: number): string {
  return sec >= 60 ? '1m' : `${sec}s`;
}

/** Netflix-style scrub: hover along a line to preview frames; movement (throttled) sets source in-point. */
function SourceInPointHoverScrubber({
  sourceUrl,
  disabled,
  clipKey,
  defaultInSec,
  savedInSec,
  onPickInPoint,
}: {
  sourceUrl: string;
  disabled: boolean;
  clipKey: string;
  defaultInSec: number;
  savedInSec: number | undefined;
  onPickInPoint: (sec: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<SourcePreviewSize>(() => readStoredPreviewSize());
  const [viewportAnchor, setViewportAnchor] = useState<{ cx: number; trackTop: number } | null>(null);
  const throttleEmitRef = useRef(0);

  const { w: previewW, h: previewH } = SOURCE_PREVIEW_SIZES[previewSize];

  const setPreviewSizePersist = useCallback((next: SourcePreviewSize) => {
    setPreviewSize(next);
    try {
      localStorage.setItem(SOURCE_PREVIEW_SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  /** Real `<video>` preview (not canvas): canvas drawImage breaks cross-origin without CORS; tiny hidden video often never decodes. */
  const seekPreview = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    const clamped = Math.max(0, Math.min(duration - 1e-3, t));
    if (Math.abs(v.currentTime - clamped) < 0.001) return;
    v.currentTime = clamped;
  }, [duration]);

  useEffect(() => {
    setLoadError(null);
    setDuration(0);
    setViewportAnchor(null);
    setHoverSec(null);
  }, [sourceUrl, clipKey]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const readDuration = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    v.addEventListener('loadedmetadata', readDuration);
    v.addEventListener('durationchange', readDuration);
    v.addEventListener('loadeddata', readDuration);
    v.addEventListener('canplay', readDuration);
    readDuration();
    return () => {
      v.removeEventListener('loadedmetadata', readDuration);
      v.removeEventListener('durationchange', readDuration);
      v.removeEventListener('loadeddata', readDuration);
      v.removeEventListener('canplay', readDuration);
    };
  }, [sourceUrl, clipKey]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    const t = savedInSec ?? defaultInSec;
    const clamped = Math.max(0, Math.min(duration - 1e-3, t));
    v.currentTime = clamped;
  }, [clipKey, defaultInSec, savedInSec, duration]);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return p * duration;
    },
    [duration]
  );

  const emitThrottled = useCallback(
    (t: number) => {
      if (disabled) return;
      const now = performance.now();
      if (now - throttleEmitRef.current < 100) return;
      throttleEmitRef.current = now;
      onPickInPoint(Math.max(0, Math.min(duration, t)));
    },
    [disabled, duration, onPickInPoint]
  );

  const nudgeInPoint = useCallback(
    (deltaSec: number) => {
      if (disabled || duration <= 0) return;
      const base = savedInSec ?? defaultInSec;
      const next = Math.max(0, Math.min(duration, base + deltaSec));
      onPickInPoint(next);
      const v = videoRef.current;
      if (v) v.currentTime = Math.max(0, Math.min(duration - 1e-3, next));
    },
    [defaultInSec, disabled, duration, onPickInPoint, savedInSec]
  );

  const handleTrackPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const t = timeFromClientX(e.clientX);
    const tr = trackRef.current;
    if (tr) {
      const r = tr.getBoundingClientRect();
      const px = Math.min(r.width, Math.max(0, e.clientX - r.left));
      setViewportAnchor({ cx: r.left + px, trackTop: r.top });
    }
    setHoverSec(t);
    seekPreview(t);

    if (e.type === 'pointerdown') {
      tr?.setPointerCapture(e.pointerId);
      onPickInPoint(Math.max(0, Math.min(duration, t)));
    }
    if (e.type === 'pointermove') {
      emitThrottled(t);
    }
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    trackRef.current?.releasePointerCapture?.(e.pointerId);
    if (disabled || duration <= 0) return;
    const t = timeFromClientX(e.clientX);
    onPickInPoint(Math.max(0, Math.min(duration, t)));
  };

  const effectiveSaved = savedInSec ?? defaultInSec;
  const markerPct = duration > 0 ? (Math.min(duration, effectiveSaved) / duration) * 100 : 0;
  const previewActive = hoverSec != null && duration > 0;
  const showFloatingPreview = previewActive && viewportAnchor != null;

  const previewPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-none rounded-lg border border-zinc-600 bg-black shadow-2xl overflow-hidden"
            style={
              showFloatingPreview
                ? {
                    position: 'fixed',
                    left: viewportAnchor.cx,
                    top: viewportAnchor.trackTop - 6,
                    transform: 'translate(-50%, -100%)',
                    width: previewW,
                    maxWidth: `min(calc(100vw - 16px), ${previewW}px)`,
                    zIndex: 100_000,
                  }
                : {
                    position: 'fixed',
                    left: -9999,
                    top: 0,
                    width: previewW,
                    zIndex: 100_000,
                  }
            }
            aria-hidden={!showFloatingPreview}
          >
            <video
              key={sourceUrl}
              ref={videoRef}
              src={sourceUrl}
              muted
              playsInline
              preload="auto"
              onError={() => {
                setLoadError('Could not load the original file for scrub preview. Check network or sign in again.');
                setDuration(0);
              }}
              style={
                showFloatingPreview
                  ? { width: '100%', aspectRatio: `${previewW} / ${previewH}` }
                  : { width: previewW, height: previewH }
              }
              className="block bg-black object-contain pointer-events-none"
            />
            <div className="px-2 py-1 text-[10px] font-mono text-zinc-300 text-center tabular-nums border-t border-zinc-800">
              {hoverSec != null ? formatTimecode(hoverSec) : '—'}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Preview size</span>
        <div
          className="flex rounded-md border border-zinc-700 bg-zinc-900/80 p-0.5"
          role="group"
          aria-label="Source preview size"
        >
          {(Object.keys(SOURCE_PREVIEW_SIZES) as SourcePreviewSize[]).map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setPreviewSizePersist(key)}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded transition-colors',
                previewSize === key
                  ? 'bg-amber-500/20 text-amber-200 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {SOURCE_PREVIEW_SIZES[key].label}
            </button>
          ))}
        </div>
      </div>
      {duration <= 0 && !loadError && (
        <p className="text-[11px] text-zinc-500">Loading source duration…</p>
      )}
      {loadError && (
        <p className="text-[11px] text-red-400/90 leading-relaxed">{loadError}</p>
      )}
      <div className="space-y-1.5">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Nudge source start</p>
        <div className="flex flex-wrap gap-1">
          {SOURCE_SKIP_STEPS.map((step) => (
            <div key={step} className="flex gap-0.5">
              <button
                type="button"
                disabled={disabled || duration <= 0}
                className="text-[10px] rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 tabular-nums"
                onClick={() => nudgeInPoint(-step)}
              >
                −{formatSkipLabel(step)}
              </button>
              <button
                type="button"
                disabled={disabled || duration <= 0}
                className="text-[10px] rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 tabular-nums"
                onClick={() => nudgeInPoint(step)}
              >
                +{formatSkipLabel(step)}
              </button>
            </div>
          ))}
        </div>
      </div>
      {previewPortal}
      <div className="relative min-h-[10px]">
        <div
          ref={trackRef}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 1000) / 1000}
          aria-valuenow={Math.round((hoverSec ?? effectiveSaved) * 1000) / 1000}
          aria-label="Pick source in-point along the full upload"
          className={cn(
            'relative h-10 w-full rounded-md bg-zinc-900 border border-zinc-700 cursor-crosshair touch-none',
            (disabled || duration <= 0) && 'opacity-50 pointer-events-none cursor-not-allowed'
          )}
          onPointerDown={handleTrackPointer}
          onPointerMove={handleTrackPointer}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={(e) => {
            trackRef.current?.releasePointerCapture?.(e.pointerId);
            setHoverSec(null);
            setViewportAnchor(null);
          }}
          onPointerLeave={(ev) => {
            if (ev.buttons === 0) {
              setHoverSec(null);
              setViewportAnchor(null);
            }
          }}
        >
          <div
            className="absolute inset-y-1 left-0 right-0 mx-1 rounded bg-zinc-800/80"
            aria-hidden
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.35)]"
            style={{ left: `${markerPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        Move along the bar to preview (like Netflix); the popover is pinned above the bar so it won&apos;t sit under the
        program preview. Use Regular / Medium / Large for an easier look. Nudge buttons fine-tune the source start; the
        amber marker shows the saved in-point.
      </p>
    </div>
  );
}

export type NleTimelineProps = {
  timeline: StoryTimeline;
  onChange: (next: StoryTimeline) => void;
  disabled?: boolean;
  selectedClipIndex: number | null;
  onSelectClip: (index: number | null) => void;
  programTimeSec: number;
  programDurationSec: number;
  onSeekProgram: (sec: number) => void;
};

type Props = NleTimelineProps;

export function ClipInspectorPanel({
  jobId,
  clip,
  clipIndex,
  clipProgramStartSec,
  scenes,
  disabled,
  onUpdate,
  onApplyScene,
}: {
  jobId: string | null;
  clip: StoryClip | null;
  clipIndex: number;
  /** Start time of this clip on the program timeline (seconds). */
  clipProgramStartSec: number;
  scenes: SceneInfo[];
  disabled: boolean;
  onUpdate: (patch: Partial<StoryClip>) => void;
  onApplyScene: (sceneIndex: number) => void;
}) {
  const [showTiming, setShowTiming] = useState(false);

  const sourceUrl = useMemo(
    () => (jobId ? apiUrlWithTokenForMedia(`/api/story-video/files/${jobId}/original`) : ''),
    [jobId]
  );

  const pickSourceInPoint = useCallback(
    (sec: number) => {
      onUpdate({ sourceInSec: sec });
    },
    [onUpdate]
  );

  if (!clip) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] px-6 text-center text-zinc-500 text-sm">
        <Scissors className="mb-3 opacity-40" size={32} />
        <p className="font-medium text-zinc-400">Inspector</p>
        <p className="text-xs mt-2 leading-relaxed">
          Click a block on the timeline to edit narration, trim, overlays, and scene source.
        </p>
      </div>
    );
  }

  const defaultVideoIn = clip.start + (clip.trimStart ?? 0);
  const defaultVideoTake = Math.max(0.05, clip.end - (clip.trimEnd ?? 0) - defaultVideoIn);
  const slotDur = clipOutputDurationSec(clip);

  return (
    <div className="p-4 space-y-4 text-zinc-200">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Clip</p>
          <p className="text-lg font-semibold text-zinc-100 tabular-nums">#{clipIndex + 1}</p>
        </div>
        <span className="text-xs font-mono text-amber-400/90 bg-amber-400/10 px-2 py-1 rounded tabular-nums">
          @ {formatTimecode(clipProgramStartSec)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-zinc-300 max-h-32 overflow-y-auto border border-zinc-800 rounded-lg p-3 bg-zinc-900/80">
        {clip.text || '—'}
      </p>

      {jobId && sourceUrl && (
        <div className="space-y-2 border border-zinc-800 rounded-lg p-3 bg-zinc-950/80">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Source start (full upload)</p>
          <SourceInPointHoverScrubber
            sourceUrl={sourceUrl}
            disabled={disabled}
            clipKey={`${clip.id}-${clipIndex}`}
            defaultInSec={defaultVideoIn}
            savedInSec={clip.sourceInSec}
            onPickInPoint={pickSourceInPoint}
          />
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            Program length (export): <span className="text-zinc-400 font-mono">{slotDur.toFixed(2)}s</span>
            {clip.programDurationSec != null ? (
              <> — follows narration; picture pads with a held frame if the scene is shorter.</>
            ) : (
              <> — from source window (start→end minus trim). Long source take is trimmed to this length.</>
            )}
          </p>
          <label className="block text-xs space-y-1">
            <span className="text-zinc-500">Program length override (s)</span>
            <input
              type="text"
              inputMode="decimal"
              disabled={disabled}
              placeholder="auto (narration / source window)"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-mono"
              value={clip.programDurationSec === undefined ? '' : String(clip.programDurationSec)}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') onUpdate({ programDurationSec: undefined });
                else {
                  const n = parseFloat(raw);
                  if (!Number.isNaN(n) && n > 0) onUpdate({ programDurationSec: n });
                }
              }}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs space-y-1 col-span-2">
              <span className="text-zinc-500">Video in-point override (s)</span>
              <input
                type="text"
                inputMode="decimal"
                disabled={disabled}
                placeholder={`auto (${defaultVideoIn.toFixed(2)})`}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-mono"
                value={clip.sourceInSec === undefined ? '' : String(clip.sourceInSec)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') onUpdate({ sourceInSec: undefined });
                  else {
                    const n = parseFloat(raw);
                    if (!Number.isNaN(n)) onUpdate({ sourceInSec: Math.max(0, n) });
                  }
                }}
              />
            </label>
            <label className="text-xs space-y-1 col-span-2">
              <span className="text-zinc-500">Source take (s)</span>
              <input
                type="text"
                inputMode="decimal"
                disabled={disabled}
                placeholder={`auto (${defaultVideoTake.toFixed(2)})`}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-mono"
                value={clip.sourceTakeSec === undefined ? '' : String(clip.sourceTakeSec)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') onUpdate({ sourceTakeSec: undefined });
                  else {
                    const n = parseFloat(raw);
                    if (!Number.isNaN(n) && n > 0) onUpdate({ sourceTakeSec: n });
                  }
                }}
              />
            </label>
          </div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Crop (%, full frame = 0,0,100,100)</p>
          <div className="grid grid-cols-2 gap-2">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="text-xs space-y-1">
                <span className="text-zinc-500">{k === 'x' ? 'Left' : k === 'y' ? 'Top' : k === 'w' ? 'Width' : 'Height'} %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                  value={Math.round((clip.cropNorm?.[k] ?? (k === 'w' || k === 'h' ? 1 : 0)) * 100)}
                  onChange={(e) => {
                    const pct = parseFloat(e.target.value);
                    const v = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) / 100 : k === 'w' || k === 'h' ? 1 : 0;
                    const prev = clip.cropNorm ?? { x: 0, y: 0, w: 1, h: 1 };
                    onUpdate({ cropNorm: { ...prev, [k]: v } });
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
            onClick={() => onUpdate({ sourceInSec: undefined, sourceTakeSec: undefined, cropNorm: undefined })}
          >
            Reset video overrides (use timeline trim only)
          </button>
        </div>
      )}
      <button
        type="button"
        className="text-xs flex items-center gap-1 text-zinc-500 hover:text-zinc-300 w-full"
        onClick={() => setShowTiming((v) => !v)}
      >
        {showTiming ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Source timing &amp; trim
      </button>

      {showTiming && (
        <div className="text-xs text-zinc-500 space-y-1 pl-1">
          <div>
            Source window: {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s
          </div>
        </div>
      )}

      {scenes.length > 0 && (
        <label className="block text-xs space-y-1.5">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">Detected scene</span>
          <select
            disabled={disabled}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-200"
            value={clip.sceneIndex ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;
              onApplyScene(parseInt(v, 10));
            }}
          >
            <option value="">Keep current range</option>
            {scenes.map((s) => (
              <option key={s.index} value={s.index}>
                Scene {s.index + 1} ({s.text?.slice(0, 36) || '…'})
              </option>
            ))}
          </select>
        </label>
      )}

      {showTiming && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs space-y-1">
            <span className="text-zinc-500">Trim start (s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              disabled={disabled}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={clip.trimStart ?? 0}
              onChange={(e) => onUpdate({ trimStart: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-zinc-500">Trim end (s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              disabled={disabled}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={clip.trimEnd ?? 0}
              onChange={(e) => onUpdate({ trimEnd: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-zinc-500">Source start (s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              disabled={disabled}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={clip.start}
              onChange={(e) => onUpdate({ start: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-zinc-500">Source end (s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              disabled={disabled}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              value={clip.end}
              onChange={(e) => onUpdate({ end: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      )}

      <label className="block text-xs space-y-1">
        <span className="text-zinc-500 uppercase tracking-wide text-[10px]">Text overlay</span>
        <input
          type="text"
          disabled={disabled}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm"
          value={clip.overlayText ?? ''}
          onChange={(e) => onUpdate({ overlayText: e.target.value })}
        />
      </label>
      <label className="block text-xs space-y-1">
        <span className="text-zinc-500 uppercase tracking-wide text-[10px]">Image overlay URL</span>
        <input
          type="url"
          disabled={disabled}
          placeholder="https://… or drag from bin"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm"
          value={clip.overlayImageUrl ?? ''}
          onChange={(e) => onUpdate({ overlayImageUrl: e.target.value })}
        />
      </label>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          disabled={disabled || !clip.overlayImageUrl?.trim()}
          className="mt-0.5 rounded border-zinc-600"
          checked={clip.overlayImageOverridesClip === true}
          onChange={(e) => onUpdate({ overlayImageOverridesClip: e.target.checked })}
        />
        <span className="text-zinc-400 leading-snug">
          Image replaces entire clip (full frame). Uncheck for a small corner watermark instead.
        </span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs space-y-1">
          <span className="text-zinc-500">Position</span>
          <select
            disabled={disabled || clip.overlayImageOverridesClip === true}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
            value={clip.overlayPosition ?? 'bottom-right'}
            onChange={(e) =>
              onUpdate({ overlayPosition: e.target.value as StoryClip['overlayPosition'] })
            }
          >
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-zinc-500">Opacity</span>
          <input
            type="number"
            min={0.1}
            max={1}
            step={0.05}
            disabled={disabled || clip.overlayImageOverridesClip === true}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
            value={clip.overlayOpacity ?? 0.85}
            onChange={(e) => onUpdate({ overlayOpacity: parseFloat(e.target.value) || 0.85 })}
          />
        </label>
      </div>
    </div>
  );
}

function StoryImageBin({
  timeline,
  onChange,
  disabled,
}: {
  timeline: StoryTimeline;
  onChange: (next: StoryTimeline) => void;
  disabled: boolean;
}) {
  const imageLibrary = timeline.imageLibrary || [];
  const [uploading, setUploading] = useState(false);

  const addLibraryImages = useCallback(
    (assets: StoryEditorImageAsset[]) => {
      onChange({
        ...timeline,
        imageLibrary: [...imageLibrary, ...assets],
      });
    },
    [imageLibrary, onChange, timeline]
  );

  const onImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      setUploading(true);
      try {
        const { getUrl } = await uploadStoryAssetWithPresignOrLocal(file, {
          kind: 'image',
          filename: file.name,
          contentType: file.type || undefined,
        });
        addLibraryImages([
          { id: crypto.randomUUID(), url: getUrl, name: file.name || 'Image' },
        ]);
      } finally {
        setUploading(false);
      }
    },
    [addLibraryImages]
  );

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold shrink-0 w-14">
        Media
      </span>
      <div className="flex flex-wrap gap-2 flex-1 min-h-[48px] items-center">
        {imageLibrary.map((img) => (
          <div
            key={img.id}
            draggable={!disabled}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', img.url);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className={cn(
              'relative h-11 w-11 rounded border border-zinc-700 overflow-hidden shrink-0 ring-1 ring-zinc-800',
              !disabled && 'cursor-grab hover:ring-cyan-500/40'
            )}
            title={img.name}
          >
            <img src={img.url} alt="" className="h-full w-full object-cover" />
          </div>
        ))}
        <label
          className={cn(
            'h-11 w-11 rounded border border-dashed border-zinc-600 flex items-center justify-center cursor-pointer hover:border-zinc-500 hover:bg-zinc-800/50',
            (disabled || uploading) && 'opacity-40 pointer-events-none'
          )}
        >
          <ImagePlus size={18} className="text-zinc-500" />
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImageFile(f);
            }}
          />
        </label>
        {imageLibrary.length === 0 && (
          <span className="text-xs text-zinc-600">Drop images on timeline clips for overlays</span>
        )}
      </div>
    </div>
  );
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.25;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function NleProgramTimeline({
  clips,
  timeline,
  onChange,
  disabled,
  selectedClipIndex,
  onSelectClip,
  programTimeSec,
  programDurationSec,
  onSeekProgram,
  onDropImageOnClip,
}: {
  clips: StoryClip[];
  timeline: StoryTimeline;
  onChange: (next: StoryTimeline) => void;
  disabled: boolean;
  selectedClipIndex: number | null;
  onSelectClip: (i: number | null) => void;
  programTimeSec: number;
  programDurationSec: number;
  onSeekProgram: (sec: number) => void;
  onDropImageOnClip: (clipIndex: number, url: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      setZoom((z) => clampZoom(z + (ev.deltaY > 0 ? -0.12 : 0.12)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const totalDur = useMemo(() => totalProgramDurationSec(clips), [clips]);
  const timelineDuration = Math.max(totalDur, programDurationSec, 0.01);

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= clips.length || from === to) return;
      const next = [...clips];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      onChange({ ...timeline, clips: next });
      if (selectedClipIndex === null) return;
      let ns = selectedClipIndex;
      if (selectedClipIndex === from) {
        ns = to;
      } else if (from < to) {
        if (selectedClipIndex > from && selectedClipIndex <= to) ns -= 1;
      } else {
        if (selectedClipIndex >= to && selectedClipIndex < from) ns += 1;
      }
      if (ns !== selectedClipIndex) onSelectClip(ns);
    },
    [clips, onChange, onSelectClip, selectedClipIndex, timeline]
  );

  const scrubTrack = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
      const t = (x / r.width) * timelineDuration;
      onSeekProgram(t);
    },
    [onSeekProgram, timelineDuration]
  );

  const playheadPct = Math.min(100, Math.max(0, (programTimeSec / timelineDuration) * 100));
  const zoomWidthPercent = zoom * 100;

  return (
    <div className="flex flex-col min-h-0 bg-zinc-950 shrink-0 select-none">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 border-b border-zinc-800/80 bg-zinc-900/40">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Sequence</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            className="p-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-[11px] font-mono text-zinc-400 w-11 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            className="p-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-transparent hover:border-zinc-700"
          >
            Fit
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-visible px-2 pt-1 pb-3 flex-1 min-h-[100px] [scrollbar-width:thin]"
      >
        <div className="relative" style={{ width: `${zoomWidthPercent}%`, minWidth: '100%' }}>
          <div className="h-7 flex items-end justify-between border-b border-zinc-800/80 relative mb-1">
            <div className="absolute inset-x-0 bottom-0 h-4 flex justify-between pointer-events-none w-full">
              {Array.from({ length: 9 }, (_, i) => {
                const t = (i / 8) * timelineDuration;
                return (
                  <span
                    key={i}
                    className="text-[9px] font-mono text-zinc-600 tabular-nums"
                    style={{ transform: i === 8 ? 'translateX(-100%)' : undefined }}
                  >
                    {formatTimecode(t)}
                  </span>
                );
              })}
            </div>
          </div>

          <div
            role="slider"
            aria-valuenow={Math.round(programTimeSec * 100) / 100}
            aria-valuemin={0}
            aria-valuemax={Math.round(timelineDuration * 100) / 100}
            tabIndex={0}
            className="relative h-[4.5rem] rounded-md bg-zinc-900 border border-zinc-800 overflow-hidden cursor-crosshair"
            onClick={scrubTrack}
            onKeyDown={(e) => {
              const step = 0.5;
              if (e.key === 'ArrowLeft') onSeekProgram(Math.max(0, programTimeSec - step));
              if (e.key === 'ArrowRight') onSeekProgram(Math.min(timelineDuration, programTimeSec + step));
            }}
          >
            <div
              className="absolute top-0 bottom-0 w-px bg-amber-400 z-20 shadow-[0_0_8px_rgba(251,191,36,0.6)] pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            />
            <div className="absolute inset-0 flex gap-1 p-1">
              {clips.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
                  No clips — run analysis to build the sequence
                </div>
              )}
              {clips.map((c, i) => {
                const w = (clipOutputDurationSec(c) / timelineDuration) * 100;
                const selected = selectedClipIndex === i;
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', String(i));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/plain') ? 'copy' : 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const url = e.dataTransfer.getData('text/plain');
                      if (url.startsWith('http')) {
                        onDropImageOnClip(i, url);
                        return;
                      }
                      const from = parseInt(url, 10);
                      if (!Number.isNaN(from)) move(from, i);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(i);
                      onSeekProgram(programStartSecForClipIndex(clips, i));
                    }}
                    style={{
                      width: `${Math.max(w, 0.8)}%`,
                      minWidth: zoom >= 1.25 ? '3.5rem' : '1.75rem',
                    }}
                    className={cn(
                      'rounded-sm text-left px-1.5 py-1 flex flex-col justify-center overflow-hidden border transition-colors shrink-0',
                      selected
                        ? 'bg-cyan-950/90 border-cyan-500/70 ring-1 ring-cyan-400/30 z-10'
                        : 'bg-gradient-to-b from-zinc-700/90 to-zinc-800/90 border-zinc-600/80 hover:from-zinc-600 hover:to-zinc-700',
                      disabled && 'opacity-50'
                    )}
                    title={`Clip ${i + 1} · ${c.text?.slice(0, 100) || '—'}`}
                  >
                    <span className="text-[9px] font-mono text-amber-200/90 tabular-nums">{i + 1}</span>
                    <span className="text-[10px] text-zinc-200 line-clamp-3 leading-tight">{c.text || '·'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-600 font-mono">
            <span>
              {formatTimecode(programTimeSec)} / {formatTimecode(timelineDuration)}
            </span>
            <span className="text-zinc-700 text-right pl-2">
              Scroll when zoomed · Wider clips = safer drag · Ctrl+wheel zoom
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TimelineEditor({
  timeline,
  onChange,
  disabled,
  selectedClipIndex,
  onSelectClip,
  programTimeSec,
  programDurationSec,
  onSeekProgram,
}: Props) {
  const clips = timeline.clips || [];

  const updateClip = useCallback(
    (index: number, patch: Partial<StoryClip>) => {
      const next = clips.map((c, i) => (i === index ? { ...c, ...patch } : c));
      onChange({ ...timeline, clips: next });
    },
    [clips, onChange, timeline]
  );

  const onDropImageOnClip = useCallback(
    (clipIndex: number, url: string) => {
      if (!url.trim()) return;
      updateClip(clipIndex, { overlayImageUrl: url.trim() });
    },
    [updateClip]
  );

  return (
    <div className="flex flex-col border-t border-zinc-800 bg-zinc-950 rounded-b-xl overflow-hidden min-h-[200px] max-h-[40vh]">
      <StoryImageBin timeline={timeline} onChange={onChange} disabled={!!disabled} />
      <NleProgramTimeline
        clips={clips}
        timeline={timeline}
        onChange={onChange}
        disabled={!!disabled}
        selectedClipIndex={selectedClipIndex}
        onSelectClip={onSelectClip}
        programTimeSec={programTimeSec}
        programDurationSec={programDurationSec}
        onSeekProgram={onSeekProgram}
        onDropImageOnClip={onDropImageOnClip}
      />
    </div>
  );
}
