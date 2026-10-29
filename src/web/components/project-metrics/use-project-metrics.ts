import { useQuery } from "@tanstack/react-query";

import { useNow } from "@/web/components/clock/use-now";
import { currentContainer } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

import { buildMetricStats } from "./metric-stats";

const REFRESH_INTERVAL_IN_MS = 15_000;

/** Samples of the last `hours` for the live container, plus the "now" stats built from them. */
export function useProjectMetrics(projectId: string, hours: number) {
  const now = useNow();
  const project = useQuery(projectQueryOptions(projectId));
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, hours],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const samples = metrics.data ?? [];
  const container = project.data == null ? null : currentContainer(project.data);
  const stats = buildMetricStats({ latest: samples.at(-1) ?? null, container, now });
  return { metrics, samples, stats };
}
