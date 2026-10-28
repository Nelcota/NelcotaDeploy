import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  BoxesIcon,
  HeartPulseIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  WebhookIcon,
} from "lucide-react";
import { useState } from "react";

import {
  durationBetween,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  pluralize,
} from "@/shared/format";
import { MetricChart } from "@/web/components/metric-chart";
import {
  MetricStrip,
  ProgressRing,
  SegmentedControl,
  SummaryCard,
  SummaryGrid,
} from "@/web/components/overview";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";
import { usagePercent } from "@/web/components/usage-meter";
import { useCan } from "@/web/components/use-permissions";
import { getDashboardFn, getHostMetricsFn } from "@/web/functions/dashboard.functions";

const REFRESH_INTERVAL_IN_MS = 10_000;
const SHORT_SHA_LENGTH = 7;
const HOURS_PER_DAY = 24;
const WINDOWS = [
  { value: 1, label: "1 hora" },
  { value: HOURS_PER_DAY, label: "24 horas" },
] as const;
const SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});

const HEALTH_LABELS = {
  healthy: { value: "Saudável", detail: "worker e Docker online", tone: "success" },
  degraded: { value: "Com alertas", detail: "há aplicações offline", tone: "warning" },
  unavailable: { value: "Indisponível", detail: "worker ou Docker fora do ar", tone: "danger" },
} as const;

type DashboardSummary = NonNullable<Awaited<ReturnType<typeof getDashboardFn>>>;

/** One sentence that says how things are, so the page reads at a glance. */
function summaryLine(data: DashboardSummary): string {
  const applications = pluralize(data.projectCount, "aplicação", "aplicações");
  if (data.projectCount === 0) {
    return "Nenhuma aplicação ainda. Crie o primeiro projeto para fazer deploy.";
  }
  if (data.health === "unavailable") {
    return `${applications} · o worker ou o Docker está fora do ar, deploys ficam na fila.`;
  }
  if (data.offlineCount > 0) {
    const offline =
      data.offlineCount === 1
        ? "1 está offline e precisa de atenção"
        : `${data.offlineCount} estão offline e precisam de atenção`;
    return `${applications} · ${offline}.`;
  }
  return `${applications} · tudo funcionando normalmente.`;
}

function percentOf(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

function DashboardPage() {
  const can = useCan();
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<(typeof SERIES)[number]["value"]>("cpu");
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const hostMetrics = useQuery({
    queryKey: ["host-metrics", hours],
    queryFn: () => getHostMetricsFn({ data: { hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data;
  const now = new Date();
  const host = data?.hostSample ?? null;
  const finished = (data?.recentDeployments ?? []).filter(
    (deployment) => deployment.status === "succeeded" || deployment.status === "failed",
  );
  const succeeded = finished.filter((deployment) => deployment.status === "succeeded").length;
  const memoryPercent = usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes);
  const selectedSeries = SERIES.find((item) => item.value === series) ?? SERIES[0];

  return (
    <>
      <section className="flex flex-col gap-6 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-1.5">
            <h1 className="text-3xl leading-tight font-medium tracking-tight">Painel</h1>
            <p className="text-base text-muted-foreground">
              {data == null ? "Carregando a situação do servidor…" : summaryLine(data)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("project:write") ? (
              <Button size="sm" asChild>
                <Link to="/projects/new">
                  <PlusIcon aria-hidden />
                  Novo projeto
                </Link>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
              <Link to="/deployments">
                <RocketIcon aria-hidden />
                Ver deploys
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/settings" search={{ tab: "server" }}>
                <WebhookIcon aria-hidden />
                Configurar webhook
              </Link>
            </Button>
          </div>
        </div>
        {data == null ? (
          <Skeleton className="h-[5.5rem] w-full rounded-xl 2xl:w-[44rem]" />
        ) : (
          <MetricStrip
            className="2xl:w-[44rem] 2xl:shrink-0"
            metrics={[
              {
                label: "Ambiente",
                icon: HeartPulseIcon,
                tone: HEALTH_LABELS[data.health].tone,
                value: HEALTH_LABELS[data.health].value,
                detail: HEALTH_LABELS[data.health].detail,
              },
              {
                label: "Aplicações online",
                icon: BoxesIcon,
                tone: data.offlineCount > 0 ? "warning" : "neutral",
                value: `${data.onlineCount} de ${data.projectCount - data.neverDeployedCount}`,
                detail:
                  data.offlineCount === 0
                    ? "nenhuma offline"
                    : pluralize(data.offlineCount, "offline", "offline"),
              },
              {
                label: "Falhas em 24 h",
                icon: AlertTriangleIcon,
                tone: data.recentFailures.length > 0 ? "danger" : "neutral",
                value: data.recentFailures.length,
                detail:
                  data.recentDeployments.length === 0
                    ? "nenhum deploy recente"
                    : `em ${pluralize(data.recentDeployments.length, "deploy recente", "deploys recentes")}`,
              },
            ]}
          />
        )}
      </section>

      {data == null ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <SummaryGrid>
          <SummaryCard
            icon={BoxesIcon}
            iconClassName="text-brand"
            title="Aplicações"
            link={{ to: "/projects" }}
            metricLabel="Online agora"
            value={data.onlineCount}
            caption={`de ${data.projectCount - data.neverDeployedCount} com deploy`}
            aside={
              <ProgressRing
                label="Aplicações online"
                percent={percentOf(data.onlineCount, data.projectCount - data.neverDeployedCount)}
              />
            }
            links={[
              { label: "Ver projetos", to: "/projects" },
              { label: "Novo projeto", to: "/projects/new" },
            ]}
          />
          <SummaryCard
            icon={RocketIcon}
            iconClassName="text-success"
            title="Deploys"
            link={{ to: "/deployments" }}
            metricLabel="Concluídos com sucesso"
            value={succeeded}
            caption={
              data.recentDeployments[0] == null
                ? "Nenhum deploy ainda"
                : `Último ${formatRelativeTime(data.recentDeployments[0].createdAt, now)}`
            }
            aside={
              <ProgressRing
                label="Taxa de sucesso"
                percent={percentOf(succeeded, finished.length)}
              />
            }
            links={[
              { label: "Histórico", to: "/deployments" },
              { label: "Webhook", to: "/settings", search: { tab: "server" } },
            ]}
          />
          <SummaryCard
            icon={ServerIcon}
            iconClassName="text-warning"
            title="Servidor"
            link={{ to: "/settings", search: { tab: "server" } }}
            metricLabel="CPU"
            value={formatPercent(host?.cpuPercent ?? null)}
            caption={
              host?.memoryTotalBytes == null
                ? "Memória indisponível"
                : `Memória ${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`
            }
            aside={<ProgressRing label="Memória em uso" percent={memoryPercent} />}
            links={[
              { label: "Recursos", to: "/settings", search: { tab: "server" } },
              { label: "Auditoria", to: "/settings", search: { tab: "audit" } },
            ]}
          />
        </SummaryGrid>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {hours === 1 ? "Última hora" : "Últimas 24 horas"} ·{" "}
            {data?.worker == null
              ? "worker nunca conectou"
              : `worker ${data.worker.online ? "online" : "offline"}, Docker ${data.worker.dockerVersion ?? "indisponível"}`}
          </p>
          <SegmentedControl
            label="Janela de tempo"
            options={WINDOWS}
            value={hours}
            onChange={setHours}
          />
        </div>
        <Card className="gap-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div
              role="radiogroup"
              aria-label="Série"
              className="inline-flex rounded-lg border bg-surface-sunken/70 p-1"
            >
              {SERIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={series === item.value}
                  onClick={() => setSeries(item.value)}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none",
                    series === item.value
                      ? "bg-surface-raised text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: `var(${item.color})` }}
                  />
                  {item.label}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              Atual{" "}
              <strong className="text-foreground tabular-nums">
                {formatPercent(series === "cpu" ? (host?.cpuPercent ?? null) : memoryPercent)}
              </strong>
            </span>
          </CardHeader>
          <CardContent>
            {hostMetrics.data == null ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <MetricChart
                label={selectedSeries.label}
                colorVariable={selectedSeries.color}
                maxValue={100}
                formatValue={(value) => `${Math.round(value)}%`}
                points={hostMetrics.data.map((sample) => ({
                  createdAt: sample.createdAt,
                  value:
                    series === "cpu"
                      ? sample.cpuPercent
                      : usagePercent(sample.memoryUsedBytes, sample.memoryTotalBytes),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deploys recentes</CardTitle>
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
            <CardTitle>Falhas recentes</CardTitle>
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
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface-raised focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{deployment.projectName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"} ·{" "}
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
