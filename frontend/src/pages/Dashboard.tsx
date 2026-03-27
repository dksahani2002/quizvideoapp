import { Link } from 'react-router-dom';
import { PlusCircle, Film, TrendingUp, Loader2 } from 'lucide-react';
import { useVideos } from '../api/videos';
import { useAuth } from '../hooks/useAuth';
import { useAuthBlobUrl } from '../hooks/useAuthBlob';
import { formatDate, formatBytes } from '../lib/utils';
import type { VideoItem } from '../types';

function VideoThumb({ video }: { video: VideoItem }) {
  const blobUrl = useAuthBlobUrl(video.status === 'completed' ? video.url : null);

  if (video.status !== 'completed') {
    return (
      <div className="w-full aspect-[9/16] max-h-64 bg-black/50 flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
        {video.status === 'generating' ? <Loader2 size={20} className="animate-spin" /> : video.status}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="w-full aspect-[9/16] max-h-64 bg-black/50 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  return (
    <video
      src={blobUrl}
      className="w-full aspect-[9/16] max-h-64 object-cover bg-black"
      muted
      preload="metadata"
    />
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { data: videos = [] } = useVideos();

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Welcome{user ? `, ${user.name}` : ''}</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Generate quiz videos for YouTube Shorts & Instagram Reels</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
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
        <Link
          to="/create"
          className="bg-[hsl(var(--primary))]/10 border-2 border-dashed border-[hsl(var(--primary))]/30 rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-[hsl(var(--primary))]/20 transition-colors"
        >
          <PlusCircle size={28} className="text-[hsl(var(--primary))]" />
          <span className="font-semibold text-[hsl(var(--primary))]">Create New Video</span>
        </Link>
      </div>

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
