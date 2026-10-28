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
  /** Compact chart shown next to the value, such as {@link MiniBars}. */
  readonly visual?: ReactNode;
};

const STAT_TONES = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** Key figures as a row of cards: label on top, the value in a recessed well, detail below. */
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
        "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
        className,
      )}
      style={{ "--stats": stats.length } as React.CSSProperties}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-card p-2.5 ring-1 ring-border/70"
        >
          <dt className="flex items-center gap-3 px-2 pt-1.5 text-sm font-medium">
            {stat.icon == null ? null : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-well ring-1 ring-border/60">
                <stat.icon aria-hidden className="size-3.5 text-muted-foreground" />
              </span>
            )}
            <span className="truncate">{stat.label}</span>
          </dt>
          <dd className="flex h-28 items-center justify-between gap-4 rounded-xl bg-well px-5 ring-1 ring-border/40">
            <span
              className={cn(
                "truncate text-3xl leading-tight font-semibold tracking-tight tabular-nums",
                STAT_TONES[stat.tone ?? "default"],
              )}
            >
              {stat.value}
            </span>
            {stat.visual == null ? null : <span className="shrink-0">{stat.visual}</span>}
          </dd>
          {stat.detail == null ? null : (
            <dd className="truncate px-2 pb-1.5 text-sm text-faint">{stat.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Rows as separate rounded blocks on one panel. */
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
        "flex flex-col gap-1.5 overflow-hidden rounded-2xl bg-card p-1.5 ring-1 ring-border/70",
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
        "relative flex items-center gap-4 rounded-xl bg-well px-4 py-3.5 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full hover:bg-well-hover",
        ROW_ACCENTS[accent],
        className,
      )}
    >
      {children}
    </div>
  );
}
