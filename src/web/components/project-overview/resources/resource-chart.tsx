import { MetricChart } from "@/web/components/monitoring/metric-chart";
import { Skeleton } from "@/web/components/ui/skeleton";

import {
  RESOURCE_SERIES,
  resourceChart,
  type ResourceSample,
  type ResourceSeries,
} from "./resource-series";

/** The chart for one series, a skeleton while loading, or a note when there are no samples. */
export function ResourceChart({
  series,
  samples,
}: {
  readonly series: ResourceSeries;
  readonly samples: readonly ResourceSample[] | null;
}) {
  if (samples == null) {
    return <Skeleton className="h-64 rounded-lg" />;
  }
  if (samples.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Sem amostras ainda. CPU e memória aparecem enquanto o contêiner roda.
      </p>
    );
  }
  const selected = RESOURCE_SERIES.find((item) => item.value === series) ?? RESOURCE_SERIES[0];
  return (
    <MetricChart
      label={selected.label}
      colorVariable={selected.color}
      {...resourceChart(series, samples)}
    />
  );
}
