import { useEffect, useState } from 'react';
import { Download, Upload, Tv, Camera, Loader2, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { useVideos, useUpload, useDeleteVideo } from '../api/videos';
import { useCancelJob, useRetryJob, useJob } from '../api/jobs';
import { formatBytes, formatDate } from '../lib/utils';
import { authFetch } from '../hooks/useAuthBlob';
import type { VideoItem } from '../types';

function StatusBadge({ status }: { status: VideoItem['status'] }) {
  const styles = {
    generating: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    completed: 'bg-green-500/10 text-green-400 border-green-500/20',
    failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {status}
    </span>
  );
}

function VideoCard({ video }: { video: VideoItem }) {
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playSrc, setPlaySrc] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  const uploadYT = useUpload('youtube');
  const uploadIG = useUpload('instagram');
  const uploadAll = useUpload('all');
  const del = useDeleteVideo();
  const jobId = video.jobId;
  const job = useJob(jobId);
  const cancelJob = useCancelJob(jobId);
  const retryJob = useRetryJob(jobId);

  const isReady = video.status === 'completed';
  const isGenerating = video.status === 'generating';
  const isFailed = video.status === 'failed';

  const effectiveSrc = playSrc;

  useEffect(() => {
    if (!isReady) return;
    if (playSrc) return;
    // Lazy fetch a play URL once the card is visible in the list.
    // This is a single small JSON call; the heavy part is only when the user hits play.
    setPlayLoading(true);
    authFetch(`/api/videos/${video.id}/play`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error('Play URL failed'))))
      .then((j) => {
        const jj = (typeof j === 'object' && j !== null) ? (j as { url?: unknown }) : null;
        const raw = typeof jj?.url === 'string' ? jj.url : null;
        if (!raw) {
          setPlaySrc(null);
          return;
        }
        // In dev, the <video> element streaming via the Vite proxy can be flaky for Range requests.
        // If we get a same-origin relative stream URL, point it directly at the backend origin.
        if (import.meta.env.DEV && raw.startsWith('/')) {
          const apiOrigin =
            (typeof import.meta.env.VITE_API_ORIGIN === 'string' && import.meta.env.VITE_API_ORIGIN) ||
            'http://localhost:3000';
          setPlaySrc(`${apiOrigin}${raw}`);
          return;
        }
        setPlaySrc(raw);
      })
      .catch(() => setPlaySrc(null))
      .finally(() => setPlayLoading(false));
  }, [isReady, playSrc, video.id]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await authFetch(`/api/videos/${video.id}/download`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = video.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Download failed');
    }
    setDownloading(false);
  }

  async function handleDelete() {
    const msg = isGenerating
      ? `Stop generation and remove “${video.filename}”? This cannot be undone.`
      : `Delete ${video.filename}? This cannot be undone.`;
    const ok = confirm(msg);
    if (!ok) return;
    setDeleting(true);
    del.mutate(video.id, {
      onSettled: () => setDeleting(false),
      onError: (e: unknown) => alert(e instanceof Error ? e.message : 'Delete failed'),
    });
  }

  return (
    <div className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="relative group">
        {isReady && effectiveSrc ? (
          <video
            src={effectiveSrc}
            className="w-full h-112 sm:h-120 lg:h-128 object-contain bg-black cursor-pointer"
            playsInline
            controls
            muted={!playing}
            preload="metadata"
            title="Tap to play/pause. First tap will unmute."
            onClick={(e) => {
              const v = e.currentTarget;
              // iOS/Safari can be picky about programmatic playback; keep this directly on a user gesture.
              if (v.paused) {
                setPlaying(true);
                v.muted = false;
                void v.play();
              } else {
                v.pause();
              }
            }}
          />
        ) : (
          <div className="w-full h-112 sm:h-120 lg:h-128 bg-black/50 flex items-center justify-center">
            {video.status === 'generating' || (isReady && (playLoading || !playSrc)) ? (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <Loader2 size={32} className="animate-spin text-[hsl(var(--primary))]" />
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {video.status === 'generating'
                    ? (video.progressMessage || 'Generating...')
                    : 'Preparing player...'}
                </p>
              </div>
            ) : (
              <AlertCircle size={32} className="text-[hsl(var(--destructive))]" />
            )}
          </div>
        )}
        {isReady && effectiveSrc && !playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium truncate flex-1">{video.filename}</p>
          <StatusBadge status={video.status} />
        </div>
        <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))] mb-4">
          <span>{video.size > 0 ? formatBytes(video.size) : '--'}</span>
          <span>{formatDate(video.createdAt)}</span>
        </div>

        {isReady && effectiveSrc && (
          <p className="mb-3 text-[11px] text-[hsl(var(--muted-foreground))]">
            Tip: tap the video to play/pause. First tap unmutes.
          </p>
        )}

        {isFailed && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="text-xs font-medium text-red-400">Failed</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] wrap-break-word">
              {video.lastError ? video.lastError : 'Unknown error'}
            </p>
            {typeof video.attempts === 'number' && (
              <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                Attempts: {video.attempts}
              </p>
            )}
          </div>
        )}

        {isReady && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              title="Download the rendered MP4 to your device"
              aria-label="Download video"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--secondary))] text-xs font-medium hover:bg-[hsl(var(--secondary))]/80 transition-colors disabled:opacity-50"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Download
            </button>

            <button
              onClick={handleDelete}
              disabled={deleting}
              title={isGenerating ? 'Stop the job and delete this video' : 'Delete this video permanently'}
              aria-label={isGenerating ? 'Stop job and delete video' : 'Delete video'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/10 text-xs font-medium text-red-400 hover:bg-red-600/20 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </button>

            <UploadBtn
              label="YouTube"
              icon={<Tv size={13} />}
              mutation={uploadYT}
              color="bg-red-600/10 text-red-400 hover:bg-red-600/20"
            />
            <UploadBtn
              label="Instagram"
              icon={<Camera size={13} />}
              mutation={uploadIG}
              color="bg-pink-600/10 text-pink-400 hover:bg-pink-600/20"
            />
            <UploadBtn
              label="All"
              icon={<Upload size={13} />}
              mutation={uploadAll}
              color="bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20"
            />
          </div>
        )}

        {(!isReady && (isFailed || isGenerating)) && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={isGenerating ? 'Stop the job and delete this video' : 'Delete this video permanently'}
              aria-label={isGenerating ? 'Stop job and delete video' : 'Delete video'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/10 text-xs font-medium text-red-400 hover:bg-red-600/20 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {isGenerating ? 'Stop & delete' : 'Delete'}
            </button>
            {isGenerating && (
              <button
                onClick={() => cancelJob.mutate()}
                disabled={cancelJob.isPending}
                title="Cancel the current generation job"
                aria-label="Cancel generation job"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-600/10 text-xs font-medium text-yellow-400 hover:bg-yellow-600/20 transition-colors disabled:opacity-50"
              >
                {cancelJob.isPending ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />}
                Cancel job
              </button>
            )}
            {isFailed && (
              <button
                onClick={() => retryJob.mutate()}
                disabled={retryJob.isPending}
                title="Retry generating this video"
                aria-label="Retry generation job"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--primary))]/10 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20 transition-colors disabled:opacity-50"
              >
                {retryJob.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshIcon />}
                Retry
              </button>
            )}
          </div>
        )}

        {job.data?.events?.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-[hsl(var(--muted-foreground))]">Job log</summary>
            <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-2">
              {job.data.events.slice(-20).map((e, idx) => (
                <div key={idx} className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  <span className="font-medium">{e.stage}</span> — {e.message}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="opacity-80">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 4v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadBtn({ label, icon, mutation, color }: {
  label: string;
  icon: React.ReactNode;
  mutation: ReturnType<typeof useUpload>;
  color: string;
}) {
  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      title={
        label === 'YouTube' ? 'Publish this video to YouTube Shorts' :
        label === 'Instagram' ? 'Publish this video to Instagram Reels' :
        label === 'All' ? 'Publish this video to both YouTube and Instagram' :
        'Upload'
      }
      aria-label={`Upload to ${label}`}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${color} disabled:opacity-50`}
    >
      {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> :
        mutation.isSuccess ? <CheckCircle size={13} /> :
        mutation.isError ? <AlertCircle size={13} /> : icon}
      {label}
    </button>
  );
}

export function VideoLibrary() {
  const { data: videos = [], isLoading } = useVideos();

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Video Library</h1>
        <p className="text-[hsl(var(--muted-foreground))]">{videos.length} video{videos.length !== 1 ? 's' : ''} generated</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
          <Loader2 size={20} className="animate-spin" />
          Loading videos...
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-16 text-[hsl(var(--muted-foreground))]">
          <p className="text-lg mb-2">No videos yet</p>
          <p className="text-sm">Go to Create Video to generate your first quiz video</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {videos.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
