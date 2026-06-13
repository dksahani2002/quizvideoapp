import { Check, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type PhaseStep = { id: string; label: string; hint: string };

export function PhaseStepper({
  phases,
  activeId,
  spinningId,
}: {
  phases: PhaseStep[];
  activeId: string;
  spinningId?: string;
}) {
  const activeIndex = phases.findIndex((p) => p.id === activeId);
  return (
    <ol className="flex flex-col sm:flex-row gap-3 sm:gap-0 sm:items-stretch mb-6">
      {phases.map((step, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={step.id} className="flex sm:flex-1 items-start sm:items-center gap-3 sm:gap-0 min-w-0">
            <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:flex-1 sm:px-2 min-w-0">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                  done && 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                  active && !done && 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]',
                  !done && !active && 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                )}
              >
                {done ? (
                  <Check size={16} />
                ) : active && spinningId === step.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-medium',
                    active ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] hidden sm:block">{step.hint}</p>
              </div>
            </div>
            {i < phases.length - 1 && (
              <div
                className={cn(
                  'hidden sm:block h-px flex-1 mx-2 mt-4',
                  done ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))]'
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
