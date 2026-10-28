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

/** Key figures as tiles on one card: the value on top, the label (and detail) at the bottom. */
export function StatRow({
  stats,
  title,
  icon,
  className,
}: {
  readonly stats: readonly Stat[];
  /** Optional card title, shown with `icon` like the other panel cards. */
  readonly title?: string;
  readonly icon?: LucideIcon;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl bg-card p-5 text-card-foreground ring-1 ring-border/70",
        className,
      )}
    >
      {title == null || icon == null ? null : <CardTitleRow icon={icon} title={title} />}
      <dl
        className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(var(--stats),minmax(0,1fr))]"
        style={{ "--stats": stats.length } as React.CSSProperties}
      >
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex min-h-28 min-w-0 flex-col-reverse justify-between gap-4 rounded-xl bg-well p-4 ring-1 ring-border/70"
          >
            <dt className="flex min-w-0 items-center gap-2 text-sm leading-tight text-muted-foreground">
              {stat.icon == null ? null : <stat.icon aria-hidden className="size-4 shrink-0" />}
              <span>{stat.label}</span>
            </dt>
            <dd className="min-w-0 space-y-1">
              <span
                className={cn(
                  "block truncate text-2xl leading-none font-semibold tracking-tight tabular-nums",
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
    </div>
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

/** Title row of a panel card: icon, title, an optional count badge and actions on the right. */
export function CardTitleRow({
  icon: Icon,
  title,
  count,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly count?: number | null;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-base font-semibold">
        <Icon aria-hidden className="size-[1.15rem] text-muted-foreground" />
        {title}
        {count == null ? null : (
          <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {children == null ? null : (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

const TILE_TONES = {
  default: "bg-well ring-border/70",
  progress: "bg-primary/25 ring-primary/30",
  danger: "bg-destructive/20 ring-destructive/30",
} as const;

/**
 * One figure in a grid of tiles: the value on top, an icon and label at the bottom. Must be
 * placed inside a `dl`.
 */
export function StatusTile({
  value,
  label,
  icon: Icon,
  iconClassName,
  tone = "default",
  detail,
}: {
  readonly value: ReactNode;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
  readonly tone?: keyof typeof TILE_TONES;
  /** Small line under the value, such as a relative time. */
  readonly detail?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-28 min-w-0 flex-col justify-between gap-4 rounded-xl p-4 ring-1",
        TILE_TONES[tone],
      )}
    >
      <dd className="min-w-0 space-y-1">
        <span className="block truncate text-2xl leading-none font-semibold tabular-nums">
          {value}
        </span>
        {detail == null ? null : (
          <span className="block truncate text-xs text-faint">{detail}</span>
        )}
      </dd>
      <dt className="flex min-w-0 items-center gap-2 text-sm leading-tight text-muted-foreground">
        <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
        <span>{label}</span>
      </dt>
    </div>
  );
}
