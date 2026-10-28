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
const HEADROOM = 1.25;

/**
 * Upper bound of the value axis: the highest sample plus headroom. Starting the axis at zero
 * keeps small fluctuations from looking like large swings and gives distinct tick labels.
 *
 * @param points - Series values; nulls are ignored.
 * @returns A positive upper bound.
 */
export function niceUpperBound(points: readonly MetricPoint[]): number {
  const highest = Math.max(0, ...points.map((point) => point.value ?? 0));
  return highest > 0 ? highest * HEADROOM : 1;
}

/** One point of a time series; null means the value could not be collected. */
export type MetricPoint = { readonly createdAt: string; readonly value: number | null };

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
}: {
  readonly label: string;
  readonly points: readonly MetricPoint[];
  readonly colorVariable: string;
  readonly formatValue: (value: number) => string;
  readonly maxValue?: number;
}) {
  const color = `var(${colorVariable})`;
  const upperBound = maxValue ?? niceUpperBound(points);
  const gradientId = `gradient-${colorVariable.replaceAll(/[^a-z0-9]/gi, "")}`;
  return (
    <figure aria-label={label} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="createdAt"
            tickFormatter={formatShortTime}
            stroke="var(--muted-foreground)"
            fontSize={11}
            minTickGap={40}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={11}
            width={64}
            tickFormatter={(value: number) => formatValue(value)}
            domain={[0, upperBound]}
            tickCount={TICK_COUNT}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
            labelFormatter={(value) => (typeof value === "string" ? formatShortTime(value) : "")}
            formatter={(value) => [
              typeof value === "number" ? formatValue(value) : "indisponível",
              label,
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
