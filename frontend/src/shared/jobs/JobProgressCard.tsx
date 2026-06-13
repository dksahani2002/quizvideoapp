import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthenticatedMediaUrl } from '../media/useAuthenticatedMediaUrl';
import { friendlyStageLabel, friendlyStatusLabel } from './friendlyLabels';
import { statusStyles } from './statusStyles';

export type JobProgressCardProps = {
  status: string;
  stage?: string;
  progressPercent: number;
  progressMessage?: string;
  error?: string;
  playEndpoint?: string;
  unavailableMessage?: string;
  stageLabels?: Record<string, string>;
  showProgressBar?: boolean;
  children?: ReactNode;
};

export function JobProgressCard({
  status,
  stage,
  progressPercent,
  progressMessage,
  error,
  playEndpoint,
  unavailableMessage = 'Preview unavailable',
  stageLabels,
  showProgressBar = false,
  children,
}: JobProgressCardProps) {
  const isReady = status === 'completed';
  const { url: playSrc, loading: playLoading } = useAuthenticatedMediaUrl(
    playEndpoint,
    isReady && !!playEndpoint
  );

  const stageText = progressMessage || friendlyStageLabel(stage || status, stageLabels);
  const percent = Math.min(100, progressPercent);

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
            {unavailableMessage}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-[hsl(var(--muted-foreground))] gap-2 px-4">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-center font-medium">{stageText}</span>
            <span className="text-xs">{percent}%</span>
            {showProgressBar && (
              <div className="w-full max-w-[200px] h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--primary))] transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusStyles(status)}`}
          >
            {friendlyStatusLabel(status)}
          </span>
        </div>
        {error && (status === 'failed' || status === 'cancelled') && (
          <p className="text-xs text-[hsl(var(--destructive))] line-clamp-2">{error}</p>
        )}
        {children}
      </div>
    </div>
  );
}
