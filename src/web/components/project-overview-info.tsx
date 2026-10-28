import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One plain sentence for everyone, with the technical detail tucked behind "Saiba mais".
 */
export function InfoNote({
  children,
  details,
  action,
}: {
  readonly children: ReactNode;
  readonly details?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-surface-sunken/60 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5 text-sm">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <p>{children}</p>
          {details == null ? null : (
            <details className="group text-muted-foreground">
              <summary className="cursor-pointer text-xs font-medium text-foreground/80 hover:text-foreground focus-visible:underline focus-visible:outline-none">
                Saiba mais
              </summary>
              <div className="mt-1.5 text-xs leading-relaxed">{details}</div>
            </details>
          )}
        </div>
      </div>
      {action == null ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
