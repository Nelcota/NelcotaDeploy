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
  { key: "other", label: "Outros", color: "var(--faint)" },
] as const;

/** Stacked bars with the deploys of each day, succeeded at the base. */
export function DeploymentsChart({ days }: { readonly days: readonly DeploymentChartDay[] }) {
  return (
    <figure aria-label="Deploys por dia" className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...days]} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
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
            cursor={{ fill: "var(--well)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 13,
            }}
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
