import { useQuery } from "@tanstack/react-query";

import { formatPercent } from "@/shared/format";
import { MetricChart } from "@/web/components/monitoring/metric-chart";
import { getHostMetricsFn } from "@/web/functions/dashboard.functions";

import {
  type HostSample,
  type HostSeries,
  hostSeriesValue,
  REFRESH_INTERVAL_IN_MS,
} from "../dashboard";

const MAX_PERCENT = 100;
const SERIES_STYLES = {
  cpu: { label: "CPU", color: "--chart-1" },
  memory: { label: "Memória", color: "--chart-2" },
} as const satisfies Record<HostSeries, { readonly label: string; readonly color: string }>;

/** Server CPU and memory samples of the last `hours`, refreshed with the dashboard. */
export function useHostMetrics(hours: number) {
  return useQuery({
    queryKey: ["host-metrics", hours],
    queryFn: () => getHostMetricsFn({ data: { hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
}

/** The newest reading of the chosen series. */
export function CurrentReading({
  samples,
  series,
}: {
  readonly samples: readonly HostSample[];
  readonly series: HostSeries;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Agora{" "}
      <span className="font-medium text-foreground tabular-nums">
        {formatPercent(hostSeriesValue(samples.at(-1), series))}
      </span>
    </p>
  );
}

export function HostChart({
  samples,
  series,
}: {
  readonly samples: readonly HostSample[];
  readonly series: HostSeries;
}) {
  const selected = SERIES_STYLES[series];
  return (
    <MetricChart
      label={selected.label}
      colorVariable={selected.color}
      maxValue={MAX_PERCENT}
      formatValue={(value) => `${Math.round(value)}%`}
      points={samples.map((sample) => ({
        createdAt: sample.createdAt,
        value: hostSeriesValue(sample, series),
      }))}
    />
  );
}
