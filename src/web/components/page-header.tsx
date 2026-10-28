import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="truncate text-[1.9rem] leading-tight font-bold tracking-tight">{title}</h1>
        {description == null ? null : (
          <div className="max-w-3xl text-[0.98rem] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions == null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
