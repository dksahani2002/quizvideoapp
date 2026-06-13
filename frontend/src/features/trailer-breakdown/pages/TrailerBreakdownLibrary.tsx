import { Link } from 'react-router-dom';
import { Loader2, Film } from 'lucide-react';
import { useTrailerJobs, type TrailerJobListItem } from '../api';
import { formatDate } from '../../../lib/utils';
import { JobProgressCard } from '../../../shared/jobs/JobProgressCard';
import { TRAILER_STAGE_LABELS } from '../../../shared/jobs/friendlyLabels';

function TrailerJobCard({ job }: { job: TrailerJobListItem }) {
  return (
    <JobProgressCard
      status={job.status}
      stage={job.stage}
      progressPercent={job.progressPercent}
      progressMessage={job.progressMessage}
      error={job.error}
      playEndpoint={`/api/trailer-breakdown/${job.jobId}/play`}
      stageLabels={TRAILER_STAGE_LABELS}
    >
      <p className="text-sm font-medium truncate" title={job.movieTitle}>
        {job.movieTitle || 'Trailer breakdown'}
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate" title={job.youtubeUrl}>
        {job.youtubeUrl}
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Updated {formatDate(job.updatedAt)}</p>
      {job.scriptPreview && (
        <p className="text-sm text-[hsl(var(--foreground))] line-clamp-2">{job.scriptPreview}</p>
      )}
      <div className="mt-auto pt-2">
        <Link
          to={`/trailer-breakdown/${job.jobId}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-2 text-sm font-medium hover:opacity-90"
        >
          <Film size={16} />
          Open
        </Link>
      </div>
    </JobProgressCard>
  );
}

export function TrailerBreakdownLibrary() {
  const { data: jobs = [], isLoading } = useTrailerJobs();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trailer Breakdown</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Paste a YouTube trailer link to generate a voiceover breakdown video.
          </p>
        </div>
        <Link
          to="/trailer-breakdown/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-medium hover:opacity-90"
        >
          New breakdown
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-[hsl(var(--muted-foreground))]">
          <Loader2 className="animate-spin" size={32} />
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-12 text-center">
          <p className="text-[hsl(var(--muted-foreground))]">No breakdown jobs yet.</p>
          <Link
            to="/trailer-breakdown/new"
            className="inline-block mt-4 text-sm text-[hsl(var(--primary))] hover:underline"
          >
            Create your first breakdown
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <TrailerJobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
