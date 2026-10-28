import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./ui/class-names";

/** A titled block of a page. Sections are separated by space; their content brings its own panel. */
export function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  /** Icon beside the title, like the one of the matching tab or card. */
  readonly icon?: LucideIcon;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-3 text-base font-semibold tracking-tight">
            {Icon == null ? null : (
              <Icon aria-hidden className="size-[1.15rem] shrink-0 text-muted-foreground" />
            )}
            {title}
          </h2>
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
        className={cn(
          "grid gap-3 lg:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
          // An odd count cannot fill two columns: stack on phones, then one row from sm.
          stats.length % 2 === 0
            ? "grid-cols-2"
            : "grid-cols-1 sm:grid-cols-[repeat(var(--stats),minmax(0,1fr))]",
        )}
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

/** A row of a {@link List}. */
export function ListRow({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-well/50",
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
    // Fixed minimum height: titles line up across cards whether or not they have buttons.
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
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
  className,
}: {
  readonly value: ReactNode;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
  readonly tone?: keyof typeof TILE_TONES;
  /** Small line under the value, such as a relative time. */
  readonly detail?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-28 min-w-0 flex-col justify-between gap-4 rounded-xl p-4 ring-1",
        TILE_TONES[tone],
        className,
      )}
    >
      <dd className="min-w-0 space-y-1">
        <span className="block truncate text-xl leading-none font-semibold tabular-nums sm:text-2xl">
          {value}
        </span>
        {detail == null ? null : (
          <span
            className="block truncate text-xs text-faint"
            title={typeof detail === "string" ? detail : undefined}
          >
            {detail}
          </span>
        )}
      </dd>
      <dt
        className={cn(
          "flex min-w-0 items-center gap-2 text-sm leading-tight",
          // Tinted tiles darken the muted gray below 4.5:1, so their label uses full contrast.
          tone === "default" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
        <span>{label}</span>
      </dt>
    </div>
  );
}

/** Small neutral label beside a name, such as "Secret", "HTTPS" or "Pausada". */
export function Tag({
  icon: Icon,
  children,
}: {
  readonly icon?: LucideIcon;
  readonly children: ReactNode;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-well px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border/60">
      {Icon == null ? null : <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

/** Marks the deployment a project is serving right now. */
export function LiveBadge() {
  return (
    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      No ar
    </span>
  );
}

/** Heading inside a {@link List} that starts the rows of one day. */
export function DayHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="bg-well/40 px-5 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/** Classes for a quiet text link with a visible keyboard focus ring. */
export const TEXT_LINK =
  "rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
