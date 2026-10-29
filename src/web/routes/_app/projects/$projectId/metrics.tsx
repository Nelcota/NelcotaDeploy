import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ClockIcon,
  ContainerIcon,
  CpuIcon,
  MemoryStickIcon,
  RotateCwIcon,
} from "lucide-react";
import { useState } from "react";

import {
  bytesToMebibytes,
  formatBytes,
  formatMebibytes,
  formatPercent,
  formatRelativeTime,
  formatShortTime,
} from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { CardTitleRow, type Stat, StatRow } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { EmptyState, ErrorState } from "@/web/components/layout/states";
import { MetricChart } from "@/web/components/monitoring/metric-chart";
import { currentContainer, TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

const WINDOWS = [
  { value: 1, label: "1 hora" },
  { value: 6, label: "6 horas" },
  { value: 24, label: "24 horas" },
] as const;
const REFRESH_INTERVAL_IN_MS = 15_000;
const MAX_CPU_PERCENT = 100;

export const Route = createFileRoute("/_app/projects/$projectId/metrics")({
  head: () => ({ meta: [{ title: "Métricas · Nelcota Deploy" }] }),
  component: ProjectMetricsPage,
});

function useProjectMetrics(projectId: string, hours: number) {
  return useQuery({
    queryKey: ["project-metrics", projectId, hours],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
}

type MetricSample = Awaited<ReturnType<typeof getProjectMetricsFn>>[number];

function ProjectMetricsPage() {
  const now = useNow();
  const { projectId } = Route.useParams();
  const [hours, setHours] = useState<number>(1);
  const project = useQuery(projectQueryOptions(projectId));
  const metrics = useProjectMetrics(projectId, hours);

  const container = project.data == null ? null : currentContainer(project.data);
  const neverDeployed = project.data != null && project.data.project.currentDeploymentId == null;
  const samples = metrics.data ?? [];
  const latest = samples.at(-1) ?? null;
  const cpuIdle = samples.length > 0 && samples.every((sample) => (sample.cpuPercent ?? 0) === 0);

  const stats: Stat[] = [
    {
      label: "CPU agora",
      icon: CpuIcon,
      value: formatPercent(latest?.cpuPercent ?? null),
      detail: latest == null ? "sem amostras" : formatRelativeTime(latest.createdAt, now),
    },
    {
      label: "Memória",
      icon: MemoryStickIcon,
      value: formatBytes(latest?.memoryUsedBytes ?? null),
      // Docker reports the host memory as the limit when the container has none.
      detail:
        latest?.memoryTotalBytes == null
          ? "limite indisponível"
          : `limite visto: ${formatBytes(latest.memoryTotalBytes)}`,
    },
    {
      label: "Reinícios",
      icon: RotateCwIcon,
      value: container == null ? "—" : container.restartCount,
      tone: (container?.restartCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: "No ar desde",
      icon: ClockIcon,
      value: container?.startedAt == null ? "—" : formatShortTime(container.startedAt),
      detail:
        container?.startedAt == null ? undefined : formatRelativeTime(container.startedAt, now),
    },
  ];

  return (
    <section aria-label="Métricas" className="space-y-6">
      <TabHeader
        title="Métricas"
        description="CPU e memória do contêiner atual, coletadas pelo worker."
        actions={
          <SegmentedControl label="Período" options={WINDOWS} value={hours} onChange={setHours} />
        }
      />

      {neverDeployed ? (
        <EmptyState
          icon={ContainerIcon}
          title="Nenhum contêiner implantado"
          description="CPU e memória passam a ser coletadas assim que o primeiro deploy colocar a aplicação no ar."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects/$projectId/deployments" params={{ projectId }}>
                Ver deploys
              </Link>
            </Button>
          }
        />
      ) : (
        <ProjectMetrics stats={stats} metrics={metrics} samples={samples} cpuIdle={cpuIdle} />
      )}
    </section>
  );
}

function ProjectMetrics({
  stats,
  metrics,
  samples,
  cpuIdle,
}: {
  readonly stats: readonly Stat[];
  readonly metrics: ReturnType<typeof useProjectMetrics>;
  readonly samples: readonly MetricSample[];
  readonly cpuIdle: boolean;
}) {
  return (
    <>
      {metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : null}
      {metrics.isPending ? (
        <>
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-80 rounded-xl" />
        </>
      ) : null}
      {metrics.isSuccess ? <StatRow title="Agora" icon={ActivityIcon} stats={stats} /> : null}
      {metrics.isSuccess && samples.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nenhuma amostra neste período"
          description="Elas aparecem enquanto o contêiner roda e o worker está online."
        />
      ) : null}
      {samples.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="gap-5 p-5">
            <CardTitleRow icon={CpuIcon} title="CPU">
              <span className="text-xs text-muted-foreground">
                {cpuIdle ? "ociosa no período" : "uso em %"}
              </span>
            </CardTitleRow>
            <MetricChart
              label="CPU"
              colorVariable="--chart-1"
              maxValue={MAX_CPU_PERCENT}
              formatValue={(value) => `${Math.round(value)}%`}
              points={samples.map((sample) => ({
                createdAt: sample.createdAt,
                value: sample.cpuPercent,
              }))}
            />
          </Card>
          <Card className="gap-5 p-5">
            <CardTitleRow icon={MemoryStickIcon} title="Memória">
              <span className="text-xs text-muted-foreground">em uso</span>
            </CardTitleRow>
            <MetricChart
              label="Memória"
              colorVariable="--chart-2"
              formatValue={formatMebibytes}
              points={samples.map((sample) => ({
                createdAt: sample.createdAt,
                value: bytesToMebibytes(sample.memoryUsedBytes),
              }))}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
