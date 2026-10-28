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
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description == null ? null : (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {actions == null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
