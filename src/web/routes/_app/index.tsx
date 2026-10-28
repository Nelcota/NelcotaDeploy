import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BoxesIcon,
  CircleCheckIcon,
  CircleOffIcon,
  type LucideIcon,
  RocketIcon,
  ServerIcon,
} from "lucide-react";

import { durationBetween, formatBytes, formatDuration, formatRelativeTime } from "@/shared/format";
import { MetricChart } from "@/web/components/metric-chart";
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge, StatusPill } from "@/web/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { UsageMeter, usagePercent } from "@/web/components/usage-meter";
import { getDashboardFn, getHostMetricsFn } from "@/web/functions/dashboard.functions";

const REFRESH_INTERVAL_IN_MS = 10_000;

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});

const HEALTH_PILLS = {
  healthy: { tone: "success", label: "Ambiente saudável" },
  degraded: { tone: "warning", label: "Ambiente com alertas" },
  unavailable: { tone: "danger", label: "Worker ou Docker indisponível" },
} as const;

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly icon: LucideIcon;
  readonly hint?: string | undefined;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardDescription>{label}</CardDescription>
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint == null ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const hostMetrics = useQuery({
    queryKey: ["host-metrics", 1],
    queryFn: () => getHostMetricsFn({ data: { hours: 1 } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data;
  const now = new Date();
  const host = data?.hostSample ?? null;
  const health = data == null ? null : HEALTH_PILLS[data.health];

  return (
    <>
      <PageHeader
        title="Painel"
        description="Visão geral das aplicações e do servidor."
        actions={
          health == null ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <StatusPill tone={health.tone} label={health.label} />
          )
        }
      />

      <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data == null ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)
        ) : (
          <>
            <StatCard
              label="Aplicações"
              value={data.projectCount}
              icon={BoxesIcon}
              hint={`${data.neverDeployedCount} sem deploy`}
            />
            <StatCard label="Online" value={data.onlineCount} icon={CircleCheckIcon} />
            <StatCard
              label="Offline"
              value={data.offlineCount}
              icon={CircleOffIcon}
              hint={data.unhealthyCount > 0 ? `${data.unhealthyCount} sem saúde` : undefined}
            />
            <StatCard
              label="Falhas (24h)"
              value={data.recentFailures.length}
              icon={AlertTriangleIcon}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerIcon aria-hidden className="size-4" />
              Servidor
            </CardTitle>
            <CardDescription>
              {data?.worker == null
                ? "Worker nunca conectou"
                : `Worker ${data.worker.online ? "online" : "offline"} · Docker ${data.worker.dockerAvailable ? (data.worker.dockerVersion ?? "") : "indisponível"}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data == null ? (
              <ListSkeleton rows={3} />
            ) : (
              <>
                <UsageMeter label="CPU" percent={host?.cpuPercent ?? null} />
                <UsageMeter
                  label="Memória"
                  percent={usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes)}
                  detail={
                    host == null
                      ? undefined
                      : `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`
                  }
                />
                <UsageMeter
                  label="Disco"
                  percent={usagePercent(host?.diskUsedBytes, host?.diskTotalBytes)}
                  detail={
                    host == null
                      ? undefined
                      : `${formatBytes(host.diskUsedBytes)} de ${formatBytes(host.diskTotalBytes)}`
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {host == null
                    ? "Nenhuma amostra coletada ainda."
                    : `Última amostra ${formatRelativeTime(host.createdAt, now)}`}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ActivityIcon aria-hidden className="size-4" />
              CPU na última hora
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hostMetrics.data == null ? (
              <Skeleton className="h-48" />
            ) : (
              <MetricChart
                label="CPU"
                colorVariable="--chart-1"
                maxValue={100}
                formatValue={(value) => `${Math.round(value)}%`}
                points={hostMetrics.data.map((sample) => ({
                  createdAt: sample.createdAt,
                  value: sample.cpuPercent,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deploys recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {data == null ? (
              <ListSkeleton />
            ) : (
              <DeploymentList
                deployments={data.recentDeployments}
                now={now}
                empty="Nenhum deploy ainda."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Falhas recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {data == null ? (
              <ListSkeleton />
            ) : (
              <DeploymentList
                deployments={data.recentFailures}
                now={now}
                empty="Nenhuma falha nas últimas 24 horas."
              />
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

type DashboardDeployment = NonNullable<
  Awaited<ReturnType<typeof getDashboardFn>>
>["recentDeployments"][number];

function DeploymentList({
  deployments,
  now,
  empty,
}: {
  readonly deployments: readonly DashboardDeployment[];
  readonly now: Date;
  readonly empty: string;
}) {
  if (deployments.length === 0) {
    return <EmptyState icon={RocketIcon} title={empty} />;
  }
  return (
    <ul className="divide-y">
      {deployments.map((deployment) => (
        <li key={deployment.id}>
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-3 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{deployment.projectName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {deployment.commitSha?.slice(0, 7) ?? "—"} ·{" "}
                {deployment.commitMessage ?? deployment.errorMessage ?? "sem mensagem"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <DeploymentStatusBadge status={deployment.status} />
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(deployment.createdAt, now)} ·{" "}
                {formatDuration(durationBetween(deployment.startedAt, deployment.finishedAt))}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
