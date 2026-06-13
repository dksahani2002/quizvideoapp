import type { ReactNode } from 'react';

export function FormSection({
  title,
  description,
  optional,
  children,
}: {
  title: string;
  description?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-4 space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
          {optional && (
            <span className="text-[10px] uppercase tracking-wide font-medium text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded border border-[hsl(var(--border))]">
              Optional
            </span>
          )}
        </div>
        {description && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}
