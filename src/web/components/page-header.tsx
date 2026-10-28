import type { ReactNode } from "react";

/**
 * Top of every page: an optional eyebrow (context such as "Projetos / Hello App"), the title,
 * one line of description and the actions on the right.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow == null ? null : (
          <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="truncate text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        {description == null ? null : (
          <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions == null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
