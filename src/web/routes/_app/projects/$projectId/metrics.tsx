import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ActivityIcon, ClockIcon, CpuIcon, MemoryStickIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { formatBytes, formatPercent, formatRelativeTime, formatShortTime } from "@/shared/format";
import { CardTitleRow, type Stat, StatRow } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { SegmentedControl } from "@/web/components/overview";
import { currentContainer, TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { ErrorState } from "@/web/components/states";
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

function ProjectMetricsPage() {
  const { projectId } = Route.useParams();
  const [hours, setHours] = useState<number>(1);
  const project = useQuery(projectQueryOptions(projectId));
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, hours],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });

  const container = project.data == null ? null : currentContainer(project.data);
  const samples = metrics.data ?? [];
  const latest = samples.at(-1) ?? null;
  const now = new Date();
  const cpuIdle = samples.length > 0 && samples.every((sample) => (sample.cpuPercent ?? 0) === 0);

  const stats: Stat[] = [
    {
      label: "CPU agora",
      icon: CpuIcon,
      value: formatPercent(latest?.cpuPercent ?? null),
      detail: latest == null ? "sem amostras" : formatRelativeTime(latest.createdAt, now),
    },
    {
      label: "Memória em uso",
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
      label: "Em execução desde",
      icon: ClockIcon,
      value: container?.startedAt == null ? "—" : formatShortTime(container.startedAt),
      detail:
        container?.startedAt == null ? undefined : formatRelativeTime(container.startedAt, now),
    },
  ];

  return (
    <section aria-label="Métricas" className="space-y-6">
      <TabHeader
        icon={ActivityIcon}
        title="Métricas"
        description="CPU e memória do contêiner atual, coletadas pelo worker."
        actions={
          <SegmentedControl label="Período" options={WINDOWS} value={hours} onChange={setHours} />
        }
      />

      <StatRow title="Agora" icon={ActivityIcon} stats={stats} />

      {metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : null}
      {metrics.isPending ? <Skeleton className="h-80 rounded-xl" /> : null}
      {metrics.isSuccess && samples.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-6 text-sm text-muted-foreground ring-1 ring-border/70">
          Nenhuma amostra neste período. Elas aparecem enquanto o contêiner roda e o worker está
          online.
        </p>
      ) : null}
      {samples.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="gap-5 p-5">
            <CardTitleRow icon={CpuIcon} title="CPU">
              <span className="text-xs text-faint">{cpuIdle ? "ociosa no período" : "%"}</span>
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
              <span className="text-xs text-faint">em uso</span>
            </CardTitleRow>
            <MetricChart
              label="Memória"
              colorVariable="--chart-2"
              formatValue={formatBytes}
              points={samples.map((sample) => ({
                createdAt: sample.createdAt,
                value: sample.memoryUsedBytes,
              }))}
            />
          </Card>
        </div>
      ) : null}
    </section>
  );
}
