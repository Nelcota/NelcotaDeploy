import { Link, type LinkComponentProps } from "@tanstack/react-router";
import { ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatPercent } from "@/shared/format";

import { cn } from "./ui/class-names";

const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_WARNING_PERCENT = 60;

const VALUE_TONES = {
  neutral: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** One figure of a {@link MetricStrip}. */
export type StripMetric = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly value: ReactNode;
  readonly detail: ReactNode;
  /** Colors the value, for figures that are a status. */
  readonly tone?: keyof typeof VALUE_TONES;
};

/** Row of key figures with the same layout each: icon, label, value and one detail line. */
export function MetricStrip({
  metrics,
  className,
}: {
  readonly metrics: readonly StripMetric[];
  readonly className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid overflow-hidden rounded-xl border bg-card sm:grid-cols-[repeat(var(--columns),minmax(0,1fr))]",
        className,
      )}
      style={{ "--columns": metrics.length } as React.CSSProperties}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={cn(
            "flex min-w-0 items-start gap-3.5 px-5 py-4",
            index > 0 ? "border-t sm:border-t-0 sm:border-l" : "",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <metric.icon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <dt className="truncate text-sm text-muted-foreground">{metric.label}</dt>
            <dd
              className={cn(
                "truncate text-2xl leading-tight font-semibold tracking-tight tabular-nums",
                VALUE_TONES[metric.tone ?? "neutral"],
              )}
            >
              {metric.value}
            </dd>
            <dd className="truncate text-xs text-muted-foreground">{metric.detail}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** Circular percentage indicator. Shows "—" when the value is unknown. */
export function ProgressRing({
  percent,
  label,
}: {
  readonly percent: number | null;
  readonly label: string;
}) {
  const known = percent != null && Number.isFinite(percent);
  const clamped = known ? Math.min(Math.max(percent, 0), 100) : 0;
  const color = clamped >= RING_WARNING_PERCENT ? "var(--success)" : "var(--chart-1)";
  return (
    <div
      role="img"
      aria-label={`${label}: ${known ? formatPercent(clamped) : "indisponível"}`}
      className="relative flex size-14 shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle
          cx="22"
          cy="22"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth="4"
        />
        <circle
          cx="22"
          cy="22"
          r={RING_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped / 100)}
        />
      </svg>
      <span className="text-xs font-bold tabular-nums">
        {known ? `${Math.round(clamped)}%` : "—"}
      </span>
    </div>
  );
}

type SummaryLink = { readonly label: string } & Pick<
  LinkComponentProps,
  "to" | "params" | "search"
>;

/**
 * Card summarizing one area: icon, title and a shortcut arrow, a big figure, an optional
 * ring and quick links in the footer.
 */
export function SummaryCard({
  icon: Icon,
  iconClassName,
  title,
  link,
  metricLabel,
  value,
  caption,
  aside,
  links,
}: {
  readonly icon: LucideIcon;
  readonly iconClassName: string;
  readonly title: string;
  readonly link: Pick<LinkComponentProps, "to" | "params" | "search">;
  readonly metricLabel: string;
  readonly value: ReactNode;
  readonly caption: ReactNode;
  readonly aside?: ReactNode;
  readonly links: readonly SummaryLink[];
}) {
  return (
    <section className="flex flex-col rounded-xl border bg-card">
      <header className="flex items-center justify-between px-5 pt-5">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          <Icon aria-hidden className={cn("size-[1.1rem]", iconClassName)} />
          {title}
        </h2>
        <Link
          {...link}
          aria-label={`Abrir ${title}`}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <ArrowUpRightIcon aria-hidden className="size-4" />
        </Link>
      </header>
      <div className="flex flex-1 items-end justify-between gap-4 px-5 pt-5 pb-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{metricLabel}</p>
          <p className="text-4xl leading-none font-bold tracking-tight tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
        {aside}
      </div>
      <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t px-5 py-3.5">
        {links.map(({ label, ...linkProps }) => (
          <Link
            key={label}
            {...linkProps}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            {label}
          </Link>
        ))}
      </footer>
    </section>
  );
}

/** Dotted frame that groups summary cards, as on the dashboard. */
export function SummaryGrid({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-[radial-gradient(circle,var(--border)_1px,transparent_1.2px)] [background-size:18px_18px] p-4 md:p-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

/** Two- or three-option pill selector, such as "1 hora / 24 horas". */
export function SegmentedControl<TValue extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: TValue; readonly label: string }[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-surface-sunken/70 p-1"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-9 rounded-lg px-3.5 text-sm font-semibold transition-colors focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none",
            option.value === value
              ? "bg-surface-raised text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.25)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
