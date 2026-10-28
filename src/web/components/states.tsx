import { AlertTriangleIcon, type LucideIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

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
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-6 py-14 text-center">
      <div className="rounded-xl bg-accent p-3.5">
        <Icon aria-hidden className="size-6 text-brand" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold">{title}</p>
        {description == null ? null : (
          <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {action}
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
  const message = error instanceof Error ? error.message : "Não foi possível carregar os dados.";
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/8 px-6 py-10 text-center"
    >
      <AlertTriangleIcon aria-hidden className="size-6 text-destructive" />
      <p className="text-sm">{message}</p>
      {onRetry == null ? null : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon aria-hidden />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
