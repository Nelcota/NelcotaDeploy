import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatShortTime } from "@/shared/format";

const TICK_COUNT = 5;
/** Headroom above the highest sample, so the line never touches the top of the chart. */
const HEADROOM = 1.1;
// Tick steps people read easily, times a power of ten. Written as text because the list
// itself is the named constant, not ten separate magic numbers.
const NICE_STEPS: readonly number[] = "1 1.5 2 2.5 3 4 5 6 8 10".split(" ").map(Number);
const DECIMAL_BASE = 10;
/** Room for the value labels; compact charts hide the axis and only keep the stroke inset. */
const AXIS_WIDTH_IN_PX = 64;
const COMPACT_INSET_IN_PX = 4;

/**
 * Upper bound of the value axis: the highest sample plus headroom. Starting the axis at zero
 * keeps small fluctuations from looking like large swings and gives distinct tick labels.
 *
 * @param points - Series values; nulls are ignored.
 * @returns A positive upper bound.
 */
export function niceUpperBound(points: readonly MetricPoint[]): number {
  const highest = Math.max(
    0,
    ...points.map((point) => point.value ?? 0).filter((value) => Number.isFinite(value)),
  );
  if (highest <= 0) {
    return 1;
  }
  const intervals = TICK_COUNT - 1;
  const rawStep = (highest * HEADROOM) / intervals;
  const magnitude = DECIMAL_BASE ** Math.floor(Math.log10(rawStep));
  const step =
    (NICE_STEPS.find((candidate) => candidate * magnitude >= rawStep) ?? DECIMAL_BASE) * magnitude;
  return step * intervals;
}

/** One point of a time series; null means the value could not be collected. */
export type MetricPoint = { readonly createdAt: string; readonly value: number | null };

function captionFor(
  label: string,
  points: readonly MetricPoint[],
  formatValue: (value: number) => string,
): string {
  const summary = summarizeMetricPoints(points);
  if (summary == null) {
    return `${label}: sem amostras no período.`;
  }
  return `${label}: atual ${formatValue(summary.latest)}, máximo ${formatValue(summary.max)} no período.`;
}

/**
 * Reads the latest and the highest measured value of a series, for a text summary of the chart.
 *
 * @param points - Samples, oldest first; missing or non-finite values are ignored.
 * @returns The last and the largest finite values, or null when there is none.
 */
export function summarizeMetricPoints(
  points: readonly MetricPoint[],
): { readonly latest: number; readonly max: number } | null {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const latest = values.at(-1);
  if (latest == null) {
    return null;
  }
  return { latest, max: Math.max(...values) };
}

type MetricChartProps = {
  readonly label: string;
  readonly points: readonly MetricPoint[];
  readonly colorVariable: string;
  readonly formatValue: (value: number) => string;
  readonly maxValue?: number;
  /** Shorter chart without the value axis, for side columns. */
  readonly compact?: boolean;
};

const TOOLTIP_CONTENT_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
};

function chartMargin(compact: boolean) {
  return { top: 6, right: 4, bottom: 0, left: compact ? COMPACT_INSET_IN_PX : 0 };
}

function AreaGradient({ id, color }: { readonly id: string; readonly color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.28} />
        <stop offset="95%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

// Gaps stay gaps: a missing sample must not be drawn as a line through it.
const AREA_STYLE = {
  type: "monotone",
  dataKey: "value",
  strokeWidth: 1.75,
  connectNulls: false,
  isAnimationActive: false,
} as const;

function formatTooltipTime(value: unknown): string {
  return typeof value === "string" ? formatShortTime(value) : "";
}

function formatTooltipValue(value: unknown, formatValue: (value: number) => string): string {
  return typeof value === "number" ? formatValue(value) : "indisponível";
}

const AXIS_STYLE = { stroke: "var(--faint)", fontSize: 11, axisLine: false, tickLine: false };

function ChartFigure({
  label,
  caption,
  className,
  children,
}: {
  readonly label: string;
  readonly caption: string;
  readonly className: string;
  readonly children: ReactElement;
}) {
  return (
    <figure aria-label={label} className={className}>
      <figcaption className="sr-only">{caption}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </figure>
  );
}

/**
 * Area chart for a percentage or byte series. Missing samples are drawn as gaps, never as
 * zeros.
 */
export function MetricChart({
  label,
  points,
  colorVariable,
  formatValue,
  maxValue,
  compact = false,
}: MetricChartProps) {
  const color = `var(${colorVariable})`;
  const upperBound = maxValue ?? niceUpperBound(points);
  const gradientId = `gradient-${colorVariable.replaceAll(/[^a-z0-9]/gi, "")}`;
  return (
    <ChartFigure
      label={label}
      caption={captionFor(label, points, formatValue)}
      className={compact ? "h-28 w-full" : "h-64 w-full"}
    >
      {/* Not focusable: a click would draw a focus box, and the caption already reads it out. */}
      <AreaChart accessibilityLayer={false} data={[...points]} margin={chartMargin(compact)}>
        <AreaGradient id={gradientId} color={color} />
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          {...AXIS_STYLE}
          dataKey="createdAt"
          tickFormatter={formatShortTime}
          minTickGap={48}
          hide={compact}
        />
        <YAxis
          {...AXIS_STYLE}
          width={compact ? 0 : AXIS_WIDTH_IN_PX}
          tickFormatter={(value: number) => formatValue(value)}
          domain={[0, upperBound]}
          tickCount={TICK_COUNT}
          hide={compact}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelFormatter={formatTooltipTime}
          formatter={(value) => [formatTooltipValue(value, formatValue), label]}
        />
        <Area {...AREA_STYLE} stroke={color} fill={`url(#${gradientId})`} />
      </AreaChart>
    </ChartFigure>
  );
}
