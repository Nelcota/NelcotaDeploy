import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./ui/class-names";

/** A titled block of a page. Sections are separated by space; their content brings its own panel. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description == null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action == null ? null : <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** One figure of a {@link StatRow}. */
export type Stat = {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: "default" | "success" | "warning" | "danger";
  /** Small icon beside the label. */
  readonly icon?: LucideIcon;
};

const STAT_TONES = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** Key figures as tiles: the value on top, the label (and detail) at the bottom. */
export function StatRow({
  stats,
  className,
}: {
  readonly stats: readonly Stat[];
  readonly className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-3 lg:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
        className,
      )}
      style={{ "--stats": stats.length } as React.CSSProperties}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex min-h-28 min-w-0 flex-col-reverse justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-border/70"
        >
          <dt className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            {stat.icon == null ? null : <stat.icon aria-hidden className="size-4 shrink-0" />}
            <span className="truncate">{stat.label}</span>
          </dt>
          <dd className="min-w-0 space-y-0.5">
            <span
              className={cn(
                "block truncate text-2xl leading-tight font-semibold tracking-tight tabular-nums",
                STAT_TONES[stat.tone ?? "default"],
              )}
            >
              {stat.value}
            </span>
            {stat.detail == null ? null : (
              <span className="block truncate text-xs text-faint">{stat.detail}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Rows separated by hairlines on one card. */
export function List({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

const ROW_ACCENTS = {
  none: "before:bg-transparent",
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-destructive",
  progress: "before:bg-brand",
  neutral: "before:bg-faint/60",
} as const;

/** A row of a {@link List}; the thin bar on the left carries the row's status. */
export function ListRow({
  accent = "none",
  children,
  className,
}: {
  readonly accent?: keyof typeof ROW_ACCENTS;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-4 px-5 py-4 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full hover:bg-well/50",
        ROW_ACCENTS[accent],
        className,
      )}
    >
      {children}
    </div>
  );
}
