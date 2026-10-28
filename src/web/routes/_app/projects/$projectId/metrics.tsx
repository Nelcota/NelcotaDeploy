import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ActivityIcon } from "lucide-react";
import { useState } from "react";

import { formatBytes, formatDateTime, formatRelativeTime } from "@/shared/format";
import { MetricChart } from "@/web/components/metric-chart";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState } from "@/web/components/states";
import { ContainerStateBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { UsageMeter, usagePercent } from "@/web/components/usage-meter";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

const WINDOWS = [
  { hours: 1, label: "1 hora" },
  { hours: 6, label: "6 horas" },
  { hours: 24, label: "24 horas" },
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

  const currentDeploymentId = project.data?.project.currentDeploymentId ?? null;
  const container =
    project.data?.containers.find((candidate) => candidate.deploymentId === currentDeploymentId) ??
    null;
  const samples = metrics.data ?? [];
  const latest = samples.at(-1) ?? null;
  const now = new Date();

  return (
    <section aria-label="Métricas" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          CPU e memória do contêiner atual, coletadas pelo worker.
        </p>
        <div role="group" aria-label="Período" className="flex gap-1">
          {WINDOWS.map((window) => (
            <Button
              key={window.hours}
              size="sm"
              variant={hours === window.hours ? "default" : "outline"}
              aria-pressed={hours === window.hours}
              onClick={() => setHours(window.hours)}
            >
              {window.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agora</CardTitle>
            <CardDescription>
              {latest == null
                ? "Sem amostras recentes"
                : `Última amostra ${formatRelativeTime(latest.createdAt, now)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeter label="CPU" percent={latest?.cpuPercent ?? null} />
            <UsageMeter
              label="Memória"
              percent={usagePercent(latest?.memoryUsedBytes, latest?.memoryTotalBytes)}
              {...(latest == null
                ? {}
                : {
                    detail: `${formatBytes(latest.memoryUsedBytes)} de ${formatBytes(latest.memoryTotalBytes)}`,
                  })}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Contêiner</CardTitle>
          </CardHeader>
          <CardContent>
            {container == null ? (
              <p className="text-sm text-muted-foreground">
                Nenhum contêiner do deploy atual foi observado pelo worker.
              </p>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Estado</dt>
                  <dd>
                    <ContainerStateBadge state={container.state} health={container.health} />
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Nome</dt>
                  <dd className="truncate font-mono text-xs">{container.name}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Em execução desde</dt>
                  <dd className="text-sm">
                    {container.startedAt == null
                      ? "—"
                      : `${formatDateTime(container.startedAt)} (${formatRelativeTime(container.startedAt, now)})`}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Reinicializações</dt>
                  <dd className="text-sm tabular-nums">{container.restartCount}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : null}
      {metrics.isPending ? <Skeleton className="h-64" /> : null}
      {metrics.isSuccess && samples.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Sem amostras"
          description="Nenhuma métrica foi coletada neste período. As amostras aparecem quando o contêiner está em execução e o worker está online."
        />
      ) : null}
      {samples.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CPU</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Memória</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricChart
                label="Memória"
                colorVariable="--chart-2"
                formatValue={formatBytes}
                points={samples.map((sample) => ({
                  createdAt: sample.createdAt,
                  value: sample.memoryUsedBytes,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
