import { cn } from '../../lib/utils';
import { FormSection } from '../../shared/ui/FormSection';
import { PhaseStepper } from '../../shared/ui/PhaseStepper';
import {
  friendlyStageLabel as sharedFriendlyStageLabel,
  STORY_STAGE_LABELS,
} from '../../shared/jobs/friendlyLabels';

export type StoryPhase = 'upload' | 'processing' | 'editor';

const PHASES: { id: StoryPhase; label: string; hint: string }[] = [
  { id: 'upload', label: 'Upload', hint: 'Add source video and narration' },
  { id: 'processing', label: 'Processing', hint: 'AI matches scenes to your script' },
  { id: 'editor', label: 'Edit & export', hint: 'Fine-tune clips and publish' },
];

export function StoryPhaseStepper({ phase }: { phase: StoryPhase }) {
  return (
    <PhaseStepper phases={PHASES} activeId={phase} spinningId="processing" />
  );
}

export { FormSection };

export function InputModeTabs<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50',
            value === opt.value
              ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--foreground))]'
              : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function friendlyStageLabel(stage: string): string {
  return sharedFriendlyStageLabel(stage, STORY_STAGE_LABELS);
}
