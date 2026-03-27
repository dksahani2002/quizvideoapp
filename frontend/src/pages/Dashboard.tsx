import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Film, TrendingUp, Loader2 } from 'lucide-react';
import { useVideos } from '../api/videos';
import { useAnalyticsSummary, useRefreshYouTubeMetrics } from '../api/analytics';
import { useAuth } from '../hooks/useAuth';
import { authFetch } from '../hooks/useAuthBlob';
import { formatDate, formatBytes } from '../lib/utils';
import type { VideoItem } from '../types';

function VideoThumb({ video }: { video: VideoItem }) {
  const [src, setSrc] = useState<string | null>(null);

  if (video.status !== 'completed') {
    return (
      <div className="w-full aspect-9/16 max-h-64 bg-black/50 flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
        {video.status === 'generating' ? <Loader2 size={20} className="animate-spin" /> : video.status}
      </div>
    );
  }

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/videos/${video.id}/play`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error('Play URL failed'))))
      .then((j) => {
        if (cancelled) return;
        const jj = (typeof j === 'object' && j !== null) ? (j as { url?: unknown }) : null;
        const raw = typeof jj?.url === 'string' ? jj.url : null;
        if (!raw) {
          setSrc(null);
          return;
        }
        if (import.meta.env.DEV && raw.startsWith('/')) {
          const apiOrigin =
            (typeof import.meta.env.VITE_API_ORIGIN === 'string' && import.meta.env.VITE_API_ORIGIN) ||
            'http://localhost:3000';
          setSrc(`${apiOrigin}${raw}`);
          return;
        }
        setSrc(raw);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [video.id]);

  if (!src) {
    return (
      <div className="w-full aspect-9/16 max-h-64 bg-black/50 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  return (
    <video
      src={src}
      className="w-full aspect-9/16 max-h-64 object-contain bg-black"
      muted
      preload="metadata"
    />
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { data: videos = [] } = useVideos();
  const { data: analytics } = useAnalyticsSummary();
  const refreshYT = useRefreshYouTubeMetrics();

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Welcome{user ? `, ${user.name}` : ''}</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Generate quiz videos for YouTube Shorts & Instagram Reels</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[hsl(var(--card))] rounded-xl p-5 border border-[hsl(var(--border))]">
          <div className="flex items-center gap-3 mb-2">
            <Film size={20} className="text-[hsl(var(--primary))]" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Total Videos</span>
          </div>
          <p className="text-3xl font-bold">{videos.length}</p>
        </div>
        <div className="bg-[hsl(var(--card))] rounded-xl p-5 border border-[hsl(var(--border))]">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp size={20} className="text-green-400" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Total Size</span>
          </div>
          <p className="text-3xl font-bold">{formatBytes(videos.reduce((s, v) => s + v.size, 0))}</p>
        </div>
        <div className="bg-[hsl(var(--card))] rounded-xl p-5 border border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <TrendingUp size={20} className="text-[hsl(var(--primary))]" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Published posts</span>
            </div>
            <button
              onClick={() => refreshYT.mutate()}
              disabled={refreshYT.isPending}
              className="text-xs text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
            >
              Refresh YouTube
            </button>
          </div>
          <p className="text-3xl font-bold">{analytics?.published ?? 0}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Failed: {analytics?.failed ?? 0}
          </p>
        </div>
        <Link
          to="/create"
          className="bg-[hsl(var(--primary))]/10 border-2 border-dashed border-[hsl(var(--primary))]/30 rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-[hsl(var(--primary))]/20 transition-colors"
        >
          <PlusCircle size={28} className="text-[hsl(var(--primary))]" />
          <span className="font-semibold text-[hsl(var(--primary))]">Create New Video</span>
        </Link>
      </div>

      {analytics?.recent?.length ? (
        <div className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Recent publishes</h2>
          <div className="space-y-2">
            {analytics.recent.slice(0, 6).map((p) => (
              <div key={p.id} className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{p.platform}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{p.status}</div>
                </div>
                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  {formatDate(p.createdAt)} {p.lastError ? `— ${p.lastError}` : ''}
                </div>
                {(() => {
                  const r = (typeof p.result === 'object' && p.result !== null) ? (p.result as Record<string, unknown>) : null;
                  const url = typeof r?.url === 'string' ? r.url : '';
                  if (!url) return null;
                  return (
                  <a className="text-xs text-[hsl(var(--primary))] hover:underline" href={url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  );
                })()}
                {(() => {
                  const r = (typeof p.result === 'object' && p.result !== null) ? (p.result as Record<string, unknown>) : null;
                  const ys = (typeof r?.youtubeStats === 'object' && r.youtubeStats !== null)
                    ? (r.youtubeStats as Record<string, unknown>)
                    : null;
                  const viewCount = typeof ys?.viewCount === 'number' ? ys.viewCount : null;
                  if (!viewCount) return null;
                  const likeCount = typeof ys?.likeCount === 'number' ? ys.likeCount : 0;
                  return (
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Views: {viewCount} Likes: {likeCount}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {videos.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Videos</h2>
          <div className="grid grid-cols-2 gap-4">
            {videos.slice(0, 4).map(video => (
              <div key={video.id} className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                <VideoThumb video={video} />
                <div className="p-4">
                  <p className="text-sm font-medium truncate">{video.filename}</p>
                  <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))] mt-1">
                    <span>{video.size > 0 ? formatBytes(video.size) : '--'}</span>
                    <span>{formatDate(video.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
