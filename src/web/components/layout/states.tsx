import { type LucideIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";

/**
 * Calm empty state: a small muted icon, one line and an optional action. Renders on the
 * same surface as a list, so it can stand in for one.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-card px-5 py-6 ring-1 ring-border/70 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{title}</p>
          {description == null ? null : (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
      </div>
      {action == null ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
}) {
  const message = toUserMessage(error, "Não foi possível carregar os dados.");
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl bg-card px-5 py-5 ring-1 ring-destructive/40 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-destructive" />
        <p className="text-sm">{message}</p>
      </div>
      {onRetry == null ? null : (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RefreshCwIcon aria-hidden />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

const DEFAULT_SKELETON_ROWS = 4;

export function ListSkeleton({ rows = DEFAULT_SKELETON_ROWS }: { readonly rows?: number }) {
  return (
    <div
      className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border/70"
      aria-busy="true"
      aria-label="Carregando"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
