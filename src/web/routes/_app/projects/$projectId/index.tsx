import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  durationBetween,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatShortTime,
} from "@/shared/format";
import { DeploymentListRow } from "@/web/components/deployment-row";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CONTAINER_STATE_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { List, ListRow, Section, type Stat, StatRow } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { currentContainer } from "@/web/components/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getDeploymentFn, listDeploymentsFn } from "@/web/functions/deployments.functions";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

const SHORT_SHA_LENGTH = 7;
const RECENT_DEPLOYMENTS = 6;
const ACTIVE_POLL_INTERVAL_IN_MS = 5000;
const IDLE_POLL_INTERVAL_IN_MS = 30_000;
const METRICS_POLL_INTERVAL_IN_MS = 30_000;

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewPage,
});

type RecentDeployment = Awaited<ReturnType<typeof listDeploymentsFn>>[number];

function useRecentDeployments(projectId: string) {
  return useQuery({
    queryKey: ["deployments", { projectId, limit: RECENT_DEPLOYMENTS }],
    queryFn: () => listDeploymentsFn({ data: { projectId, limit: RECENT_DEPLOYMENTS } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((deployment) =>
        ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status),
      )
        ? ACTIVE_POLL_INTERVAL_IN_MS
        : IDLE_POLL_INTERVAL_IN_MS,
  });
}

function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  const details = useQuery(projectQueryOptions(projectId));
  const recent = useRecentDeployments(projectId);

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = details.data;
  return (
    <div className="space-y-10">
      <OverviewStats details={data} latest={recent.data?.[0] ?? null} />
      <div className="grid gap-10 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <RecentDeployments projectId={projectId} deployments={recent.data ?? null} />
        </div>
        <div className="min-w-0 space-y-10 lg:col-span-2">
          <Addresses details={data} />
          <ContainerFacts details={data} />
          <Resources projectId={projectId} />
        </div>
      </div>
      <ConfigurationLine details={data} />
    </div>
  );
}

function OverviewStats({
  details,
  latest,
}: {
  readonly details: ProjectDetails;
  readonly latest: RecentDeployment | null;
}) {
  const { project } = details;
  const container = currentContainer(details);
  const current = useQuery({
    queryKey: ["deployment", project.currentDeploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId: project.currentDeploymentId ?? "" } }),
    enabled: project.currentDeploymentId != null,
  });
  const now = new Date();
  const running = container?.state === "running";
  const sha = current.data?.commitSha ?? null;
  const restarts = container?.restartCount ?? 0;
  const startedAt = running ? (container.startedAt ?? null) : null;

  let statusTone: Stat["tone"] = "default";
  if (container != null) {
    statusTone = running && container.health !== "unhealthy" ? "success" : "warning";
  }
  let latestTone: Stat["tone"] = "default";
  if (latest?.status === "failed") {
    latestTone = "danger";
  }

  const stats: Stat[] = [
    {
      label: "Status",
      value:
        container == null
          ? "Sem contêiner"
          : (CONTAINER_STATE_LABELS[container.state] ?? container.state),
      detail: container?.health ?? undefined,
      tone: statusTone,
    },
    {
      label: "Último deploy",
      value: latest == null ? "—" : DEPLOYMENT_STATUS_LABELS[latest.status],
      detail: latest == null ? "nenhum ainda" : formatRelativeTime(latest.createdAt, now),
      tone: latestTone,
    },
    {
      label: "Commit",
      value: <span className="font-mono">{sha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}</span>,
      detail: current.data?.commitMessage ?? undefined,
    },
    {
      label: "Reinícios",
      value: container == null ? "—" : restarts,
      tone: restarts > 0 ? "warning" : "default",
    },
    {
      label: "Iniciado",
      value: startedAt == null ? "—" : formatShortTime(startedAt),
      detail: startedAt == null ? undefined : formatRelativeTime(startedAt, now),
    },
  ];
  // The tabs above already draw a line, so the row only needs the one below.
  return <StatRow stats={stats} className="border-t-0 pt-0" />;
}

function RecentDeployments({
  projectId,
  deployments,
}: {
  readonly projectId: string;
  readonly deployments: readonly RecentDeployment[] | null;
}) {
  const now = new Date();
  return (
    <Section
      title="Deploys recentes"
      action={
        <Link
          to="/projects/$projectId/deployments"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver todos
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      }
    >
      {deployments == null ? <ListSkeleton rows={3} /> : null}
      {deployments?.length === 0 ? (
        <List>
          <ListRow>
            <p className="text-sm text-muted-foreground">
              Nenhum deploy ainda. Use o botão Deploy acima para publicar a primeira versão.
            </p>
          </ListRow>
        </List>
      ) : null}
      {deployments == null || deployments.length === 0 ? null : (
        <List>
          {deployments.map((deployment) => (
            <DeploymentListRow
              key={deployment.id}
              projectId={projectId}
              deploymentId={deployment.id}
              status={deployment.status}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-3">
                  <Link
                    to="/projects/$projectId/deployments/$deploymentId"
                    params={{ projectId, deploymentId: deployment.id }}
                    className="shrink-0 font-mono text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ??
                      `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`}
                  </Link>
                  <span className="truncate text-sm">
                    {deployment.commitMessage ?? "sem mensagem"}
                  </span>
                </div>
                <p className="truncate text-xs text-faint">
                  {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} · {deployment.triggeredByLabel} ·{" "}
                  {formatRelativeTime(deployment.createdAt, now)} ·{" "}
                  {formatDuration(durationBetween(deployment.startedAt, deployment.finishedAt))}
                </p>
              </div>
              <DeploymentStatusBadge status={deployment.status} />
            </DeploymentListRow>
          ))}
        </List>
      )}
    </Section>
  );
}

function Addresses({ details }: { readonly details: ProjectDetails }) {
  const { project, domains } = details;
  const manage = (
    <Link
      to="/projects/$projectId/domains"
      params={{ projectId: project.id }}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      Gerenciar
    </Link>
  );
  return (
    <Section title="Endereços" action={manage}>
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum domínio.{" "}
          <Link
            to="/projects/$projectId/domains"
            params={{ projectId: project.id }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Adicionar domínio
          </Link>
        </p>
      ) : (
        <ul className="space-y-2.5">
          {domains.map((domain) => {
            const url = `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
            return (
              <li key={domain.hostname} className="flex items-center justify-between gap-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex min-w-0 items-center gap-2 font-mono text-sm hover:text-foreground"
                >
                  <span className="truncate group-hover:underline">{domain.hostname}</span>
                  <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0 text-faint" />
                  <span className="sr-only"> (abre em nova aba)</span>
                </a>
                <span className="shrink-0 text-xs text-faint">
                  {domain.httpsEnabled ? "HTTPS" : "HTTP"}
                  {domain.automatic ? " · automático" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm">{children}</dd>
    </div>
  );
}

function ContainerFacts({ details }: { readonly details: ProjectDetails }) {
  const container = currentContainer(details);
  const others = details.containers.length - (container == null ? 0 : 1);
  return (
    <Section title="Contêiner">
      {container == null ? (
        <p className="text-sm text-muted-foreground">Nenhum contêiner em execução.</p>
      ) : (
        <dl className="space-y-2.5">
          <Fact label="Nome">
            <span className="font-mono" title={container.name}>
              {container.name}
            </span>
          </Fact>
          <Fact label="Imagem">
            <span className="font-mono" title={container.image}>
              {container.image}
            </span>
          </Fact>
          <Fact label="Estado">
            {CONTAINER_STATE_LABELS[container.state] ?? container.state}
            {container.health == null ? "" : ` · ${container.health}`}
          </Fact>
          {others > 0 ? (
            <Fact label="Outros">
              {others === 1 ? "1 contêiner antigo" : `${others} contêineres antigos`}
            </Fact>
          ) : null}
        </dl>
      )}
    </Section>
  );
}

function Resources({ projectId }: { readonly projectId: string }) {
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, 1],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours: 1 } }),
    refetchInterval: METRICS_POLL_INTERVAL_IN_MS,
  });
  const samples = metrics.data ?? [];
  const latest = samples.at(-1) ?? null;
  return (
    <Section
      title="Recursos"
      description="Última hora"
      action={
        <Link
          to="/projects/$projectId/metrics"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Métricas
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      }
    >
      {metrics.data == null ? <Skeleton className="h-28 rounded-lg" /> : null}
      {metrics.data != null && samples.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sem amostras ainda. CPU e memória aparecem enquanto o contêiner roda.
        </p>
      ) : null}
      {latest == null ? null : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">CPU</span>
              <span className="font-medium tabular-nums">{formatPercent(latest.cpuPercent)}</span>
            </p>
            <MetricChart
              compact
              label="CPU"
              colorVariable="--chart-1"
              maxValue={100}
              formatValue={(value) => `${Math.round(value)}%`}
              points={samples.map((sample) => ({
                createdAt: sample.createdAt,
                value: sample.cpuPercent,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Memória</span>
              <span className="font-medium tabular-nums">
                {formatBytes(latest.memoryUsedBytes)}
              </span>
            </p>
            <MetricChart
              compact
              label="Memória"
              colorVariable="--chart-2"
              formatValue={(value) => formatBytes(value)}
              points={samples.map((sample) => ({
                createdAt: sample.createdAt,
                value: sample.memoryUsedBytes,
              }))}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

function ConfigurationLine({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const healthCheck =
    project.healthCheckPath == null ? "conexão TCP" : `HTTP ${project.healthCheckPath}`;
  return (
    <p className="border-t border-border pt-6 text-sm text-faint">
      <span className="font-mono">{project.dockerfilePath}</span> · porta {project.internalPort} ·
      saúde por {healthCheck} · deploy {project.autoDeploy ? "automático a cada push" : "manual"} ·{" "}
      <Link
        to="/projects/$projectId/settings"
        params={{ projectId: project.id }}
        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Ajustes
      </Link>
    </p>
  );
}
