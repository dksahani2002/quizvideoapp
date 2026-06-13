import { Link } from 'react-router-dom';
import { Loader2, Clapperboard } from 'lucide-react';
import { useStoryVideoJobs, type StoryVideoJobListItem } from '../api';
import { formatDate } from '../../../lib/utils';
import { JobProgressCard } from '../../../shared/jobs/JobProgressCard';
import { STORY_STAGE_LABELS } from '../../../shared/jobs/friendlyLabels';

function StoryJobCard({ job }: { job: StoryVideoJobListItem }) {
  return (
    <JobProgressCard
      status={job.status}
      stage={job.stage}
      progressPercent={job.progressPercent}
      progressMessage={job.progressMessage}
      error={job.error}
      playEndpoint={`/api/story-video/${job.jobId}/play`}
      unavailableMessage="Preview unavailable (open in editor to refresh)"
      stageLabels={STORY_STAGE_LABELS}
      showProgressBar
    >
      <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate" title={job.jobId}>
        {job.jobId.slice(-8)}
      </span>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Updated {formatDate(job.updatedAt)}</p>
      {job.scriptPreview ? (
        <p className="text-sm text-[hsl(var(--foreground))] line-clamp-3">{job.scriptPreview}</p>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))] italic">No script text on file</p>
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
    </JobProgressCard>
  );
}

export function StoryVideoLibrary() {
  const { data: jobs = [], isLoading } = useStoryVideoJobs();

  return (
    <div className="max-w-5xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Story videos</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            Narration-driven edits from your source footage.{' '}
            {jobs.length > 0 && (
              <>
                {jobs.length} project{jobs.length !== 1 ? 's' : ''}.{' '}
              </>
            )}
            Quiz shorts are in{' '}
            <Link to="/videos" className="text-[hsl(var(--primary))] font-medium hover:underline">
              Video Library
            </Link>
            .
          </p>
        </div>
        <Link
          to="/story-video"
          className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2 text-sm font-medium hover:opacity-90"
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
          <p className="text-sm mb-4 max-w-md mx-auto">
            Upload source video and narration to auto-build a scene-matched edit you can fine-tune in the timeline editor.
          </p>
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
