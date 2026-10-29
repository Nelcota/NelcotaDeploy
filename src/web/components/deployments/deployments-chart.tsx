import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatShortDay } from "@/shared/format";

const AXIS_WIDTH_IN_PX = 28;
const CORNER_RADIUS_IN_PX = 4;
/** Only the top corners of the top bar of each stack are rounded. */
const BAR_RADIUS: [number, number, number, number] = [
  CORNER_RADIUS_IN_PX,
  CORNER_RADIUS_IN_PX,
  0,
  0,
];

/** Deploys of one day, split by outcome. */
export type DeploymentChartDay = {
  readonly day: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
};

const SERIES = [
  { key: "succeeded", label: "Concluídos", color: "var(--success)" },
  { key: "failed", label: "Falharam", color: "var(--destructive)" },
  { key: "other", label: "Cancelados ou em andamento", color: "var(--muted-foreground)" },
] as const;

/**
 * Adds up the deploys of every day, for a text summary of the chart.
 *
 * @param days - Per-day counts.
 * @returns Totals by outcome.
 */
export function totalDeploymentDays(days: readonly DeploymentChartDay[]): {
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
} {
  let succeeded = 0;
  let failed = 0;
  let other = 0;
  for (const day of days) {
    succeeded += day.succeeded;
    failed += day.failed;
    other += day.other;
  }
  return { succeeded, failed, other };
}

function captionFor(days: readonly DeploymentChartDay[]): string {
  const totals = totalDeploymentDays(days);
  return `Últimos ${days.length} dias: ${totals.succeeded} concluídos, ${totals.failed} falharam, ${totals.other} cancelados ou em andamento.`;
}

const CHART_MARGIN = { top: 6, right: 4, bottom: 0, left: 0 };
const TOOLTIP_CONTENT_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
};

/** Stacked bars with the deploys of each day, succeeded at the base. */
export function DeploymentsChart({ days }: { readonly days: readonly DeploymentChartDay[] }) {
  return (
    <figure aria-label="Deploys por dia" className="h-56 w-full">
      <figcaption className="sr-only">{captionFor(days)}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        {/* Not focusable: a click would draw a focus box, and the caption already reads it out. */}
        <BarChart data={[...days]} margin={CHART_MARGIN} accessibilityLayer={false}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={formatShortDay}
            stroke="var(--faint)"
            fontSize={11}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            stroke="var(--faint)"
            fontSize={11}
            width={AXIS_WIDTH_IN_PX}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={false}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelFormatter={(value) => (typeof value === "string" ? formatShortDay(value) : "")}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stackId="deploys"
              fill={series.color}
              {...(index === SERIES.length - 1 ? { radius: BAR_RADIUS } : {})}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
