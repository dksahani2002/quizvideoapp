import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Clapperboard } from 'lucide-react';
import { useStoryVideoJobs, type StoryVideoJobListItem } from '../api';
import { formatDate } from '../../lib/utils';
import { authFetch } from '../../hooks/useAuthBlob';
import { apiUrlWithTokenForMedia } from '../../lib/mediaUrl';

function statusStyles(status: string) {
  if (status === 'completed') return 'bg-green-500/10 text-green-400 border-green-500/20';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
}

function StoryJobCard({ job }: { job: StoryVideoJobListItem }) {
  const [playSrc, setPlaySrc] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  const isReady = job.status === 'completed';

  useEffect(() => {
    if (!isReady) return;
    if (playSrc) return;
    setPlayLoading(true);
    authFetch(`/api/story-video/${job.jobId}/play`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error('play'))))
      .then((j: { success?: boolean; url?: string }) => {
        const raw = typeof j?.url === 'string' ? j.url : null;
        if (!raw) {
          setPlaySrc(null);
          return;
        }
        if (import.meta.env.DEV && raw.startsWith('/')) {
          const apiOrigin =
            (typeof import.meta.env.VITE_API_ORIGIN === 'string' && import.meta.env.VITE_API_ORIGIN.trim()) ||
            'http://127.0.0.1:3000';
          setPlaySrc(apiUrlWithTokenForMedia(`${apiOrigin.replace(/\/$/, '')}${raw}`));
          return;
        }
        setPlaySrc(raw.startsWith('/api/') ? apiUrlWithTokenForMedia(raw) : raw);
      })
      .catch(() => setPlaySrc(null))
      .finally(() => setPlayLoading(false));
  }, [isReady, playSrc, job.jobId]);

  return (
    <div className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="relative bg-black aspect-video">
        {isReady && playSrc ? (
          <video
            src={playSrc}
            className="w-full h-full object-contain"
            controls
            playsInline
            preload="metadata"
          />
        ) : isReady && playLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[hsl(var(--muted-foreground))]">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : isReady ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))] px-4 text-center">
            Preview unavailable (open in editor to refresh)
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-[hsl(var(--muted-foreground))] gap-2 px-4">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-center">{job.progressMessage || job.stage || job.status}</span>
            <div className="w-full max-w-[200px] h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-[width]"
                style={{ width: `${Math.min(100, job.progressPercent)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusStyles(job.status)}`}>
            {job.status}
          </span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate" title={job.jobId}>
            {job.jobId.slice(-8)}
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Updated {formatDate(job.updatedAt)}
        </p>
        {job.scriptPreview ? (
          <p className="text-sm text-[hsl(var(--foreground))] line-clamp-3">{job.scriptPreview}</p>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))] italic">No script text on file</p>
        )}
        {job.error && (job.status === 'failed' || job.status === 'cancelled') && (
          <p className="text-xs text-[hsl(var(--destructive))] line-clamp-2">{job.error}</p>
        )}
        <div className="mt-auto pt-2">
          <Link
            to={`/story-video?jobId=${encodeURIComponent(job.jobId)}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Clapperboard size={16} />
            Open in editor
          </Link>
        </div>
      </div>
    </div>
  );
}

export function StoryVideoLibrary() {
  const { data: jobs = [], isLoading } = useStoryVideoJobs();

  return (
    <div className="max-w-5xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Story library</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {jobs.length} story export{jobs.length !== 1 ? 's' : ''} — quiz videos stay under{' '}
            <Link to="/videos" className="text-[hsl(var(--primary))] font-medium hover:underline">
              Video Library
            </Link>
            .
          </p>
        </div>
        <Link
          to="/story-video"
          className="rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          New story video
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
          <Loader2 size={20} className="animate-spin" />
          Loading story jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-[hsl(var(--muted-foreground))]">
          <p className="text-lg mb-2">No story videos yet</p>
          <p className="text-sm mb-4">Create one from narration + source video (separate from quiz shorts).</p>
          <Link
            to="/story-video"
            className="inline-flex rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2 text-sm font-medium"
          >
            Start a story job
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {jobs.map((job) => (
            <StoryJobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
