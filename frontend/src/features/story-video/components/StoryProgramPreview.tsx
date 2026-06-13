import { type RefObject } from 'react';
import { Play, Pause } from 'lucide-react';
import { apiUrlWithTokenForMedia } from '../../lib/mediaUrl';
import {
  PREVIEW_OVERLAY_CORNER_CLASS,
  type PreviewImageOverlay,
} from './storyPreviewOverlay';

type Props = {
  playUrl: string;
  videoCacheBust: number;
  previewBlocked: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  overlay: PreviewImageOverlay | null;
  programTimeSec: number;
  programDurationSec: number;
  previewPlaying: boolean;
  videoLoadError: string | null;
  onProgramTimeSec: (sec: number) => void;
  onProgramDurationSec: (sec: number) => void;
  onPreviewPlaying: (playing: boolean) => void;
  onVideoLoadError: (message: string) => void;
  onTogglePlay: () => void;
};

export function StoryProgramPreview({
  playUrl,
  videoCacheBust,
  previewBlocked,
  videoRef,
  overlay,
  programTimeSec,
  programDurationSec,
  previewPlaying,
  videoLoadError,
  onProgramTimeSec,
  onProgramDurationSec,
  onPreviewPlaying,
  onVideoLoadError,
  onTogglePlay,
}: Props) {
  const syncDuration = () => {
    const d = videoRef.current?.duration;
    onProgramDurationSec(Number.isFinite(d) && d ? d : 0);
  };

  return (
    <>
      <div className="flex-1 min-h-[200px] flex flex-col bg-black relative">
        {previewBlocked ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm px-6 text-center">
            Exporting a new cut… preview returns when processing finishes.
          </div>
        ) : playUrl ? (
          <>
            <div className="flex-1 flex flex-col min-h-0 relative">
              <video
                key={`${playUrl}-${videoCacheBust}`}
                ref={videoRef}
                src={apiUrlWithTokenForMedia(playUrl, videoCacheBust)}
                playsInline
                className={`w-full flex-1 min-h-0 object-contain bg-black${overlay?.fullFrame ? ' opacity-0' : ''}`}
                onTimeUpdate={() => onProgramTimeSec(videoRef.current?.currentTime ?? 0)}
                onLoadedMetadata={syncDuration}
                onDurationChange={syncDuration}
                onPlay={() => onPreviewPlaying(true)}
                onPause={() => onPreviewPlaying(false)}
                onEnded={() => onPreviewPlaying(false)}
                onError={() =>
                  onVideoLoadError(
                    'Preview failed. Set VITE_API_PROXY_TARGET to your API port and restart Vite.'
                  )
                }
              />
              {overlay?.fullFrame ? (
                <img
                  src={overlay.url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none bg-black"
                  draggable={false}
                />
              ) : (
                overlay && (
                  <img
                    src={overlay.url}
                    alt=""
                    className={
                      PREVIEW_OVERLAY_CORNER_CLASS[overlay.position] ??
                      PREVIEW_OVERLAY_CORNER_CLASS['bottom-right']
                    }
                    style={{ opacity: overlay.opacity }}
                    draggable={false}
                  />
                )
              )}
            </div>
            {videoLoadError && (
              <p className="absolute bottom-14 left-0 right-0 text-center text-xs text-red-400 px-2">
                {videoLoadError}
              </p>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            No program preview — refresh URLs or wait for export.
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-3 px-3 py-2.5 bg-zinc-900 border-t border-zinc-800">
        <button
          type="button"
          disabled={!playUrl || previewBlocked}
          onClick={onTogglePlay}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-30"
          aria-label={previewPlaying ? 'Pause' : 'Play'}
        >
          {previewPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <div className="text-xs font-mono text-cyan-400/90 tabular-nums">
          {programTimeSec.toFixed(2)}s
          {programDurationSec > 0 && (
            <span className="text-zinc-500"> / {programDurationSec.toFixed(2)}s</span>
          )}
        </div>
        <span className="text-[10px] text-zinc-600 ml-auto hidden sm:inline text-right max-w-[280px]">
          Space: play · ⌘Z undo · ⌘⇧Z redo · Timeline: Ctrl+wheel zoom
        </span>
      </div>
    </>
  );
}
