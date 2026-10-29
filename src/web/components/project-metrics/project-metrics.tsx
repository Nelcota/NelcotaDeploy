import { ActivityIcon } from "lucide-react";

import { StatRow } from "@/web/components/layout/layout";
import { EmptyState, ErrorState } from "@/web/components/layout/states";
import { Skeleton } from "@/web/components/ui/skeleton";

import { MetricCharts } from "./metric-charts";
import { useProjectMetrics } from "./use-project-metrics";

/** Stats and charts of the live container over the last `hours`, with loading and error states. */
export function ProjectMetrics({
  projectId,
  hours,
}: {
  readonly projectId: string;
  readonly hours: number;
}) {
  const { metrics, samples, stats } = useProjectMetrics(projectId, hours);
  return (
    <>
      {metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : null}
      {metrics.isPending ? <MetricsSkeleton /> : null}
      {metrics.isSuccess ? <StatRow title="Agora" icon={ActivityIcon} stats={stats} /> : null}
      {metrics.isSuccess && samples.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nenhuma amostra neste período"
          description="Elas aparecem enquanto o contêiner roda e o worker está online."
        />
      ) : null}
      {samples.length > 0 ? <MetricCharts samples={samples} /> : null}
    </>
  );
}

function MetricsSkeleton() {
  return (
    <>
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-80 rounded-xl" />
    </>
  );
}
