import type { ReactNode } from "react";

import { cn } from "./ui/class-names";

/** A titled block of a page. Sections are separated by space, not by boxes. */
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
};

const STAT_TONES = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** Key figures side by side, divided by hairlines, without frames. */
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
        "grid grid-cols-2 gap-x-6 gap-y-6 border-y md:gap-x-0 border-border py-6 md:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
        className,
      )}
      style={{ "--stats": stats.length } as React.CSSProperties}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "min-w-0 space-y-1 md:px-5 md:first:pl-0",
            index > 0 ? "md:border-l md:border-border" : "",
          )}
        >
          <dt className="text-sm text-muted-foreground">{stat.label}</dt>
          <dd
            className={cn(
              "truncate text-2xl leading-tight font-semibold tracking-tight tabular-nums",
              STAT_TONES[stat.tone ?? "default"],
            )}
          >
            {stat.value}
          </dd>
          {stat.detail == null ? null : (
            <dd className="truncate text-xs text-faint">{stat.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Rows separated by hairlines on a single surface. */
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
        "divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border/70",
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
        "relative flex items-center gap-4 px-5 py-4 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full hover:bg-surface-raised/60",
        ROW_ACCENTS[accent],
        className,
      )}
    >
      {children}
    </div>
  );
}
