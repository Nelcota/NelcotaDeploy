import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  UnlockIcon,
} from "lucide-react";

import {
  durationBetween,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  pluralize,
} from "@/shared/format";
import { ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_TRIGGER_LABELS } from "@/web/components/labels";
import { MetricChart } from "@/web/components/metric-chart";
import { ProjectHeader } from "@/web/components/project-header";
import { InfoNote } from "@/web/components/project-overview-info";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ListSkeleton } from "@/web/components/states";
import {
  ContainerStateBadge,
  DeploymentStatusBadge,
  StatusPill,
} from "@/web/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

const SHORT_SHA_LENGTH = 7;
const RECENT_DEPLOYMENTS = 5;
const ACTIVE_POLL_INTERVAL_IN_MS = 5000;
const IDLE_POLL_INTERVAL_IN_MS = 30_000;
const METRICS_POLL_INTERVAL_IN_MS = 30_000;

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewPage,
});

function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  const details = useQuery(projectQueryOptions(projectId));

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = details.data;
  return (
    <>
      <ProjectHeader details={data} />
      <ConfigurationLine details={data} />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <RecentDeployments projectId={projectId} />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <DomainsCard details={data} />
          <ContainersCard details={data} />
        </div>
      </div>
      <ResourcesCard projectId={projectId} />
    </>
  );
}

function ConfigurationLine({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const healthCheck =
    project.healthCheckPath == null ? "conexão TCP" : `HTTP ${project.healthCheckPath}`;
  return (
    <InfoNote
      action={
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId: project.id }}
          className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <SettingsIcon aria-hidden className="size-4" />
          Ajustes do projeto
        </Link>
      }
      details={
        project.autoDeploy
          ? "Cada push na branch dispara um deploy pelo webhook do GitHub (URL em Administração › Servidor, evento “push”)."
          : undefined
      }
    >
      <span className="font-mono">{project.dockerfilePath}</span> · porta {project.internalPort} ·
      saúde por {healthCheck} · deploy {project.autoDeploy ? "automático" : "manual"}
    </InfoNote>
  );
}

function RecentDeployments({ projectId }: { readonly projectId: string }) {
  const deployments = useQuery({
    queryKey: ["deployments", { projectId, limit: RECENT_DEPLOYMENTS }],
    queryFn: () => listDeploymentsFn({ data: { projectId, limit: RECENT_DEPLOYMENTS } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((deployment) =>
        ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status),
      )
        ? ACTIVE_POLL_INTERVAL_IN_MS
        : IDLE_POLL_INTERVAL_IN_MS,
  });
  const now = new Date();
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <RocketIcon aria-hidden className="size-4" />
          Deploys recentes
        </CardTitle>
        <Link
          to="/projects/$projectId/deployments"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Ver todos
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {deployments.data == null ? <ListSkeleton rows={3} /> : null}
        {deployments.data?.length === 0 ? (
          <EmptyState
            icon={RocketIcon}
            title="Nenhum deploy ainda"
            description="Clique em Deploy para publicar a aplicação."
          />
        ) : null}
        {deployments.data == null || deployments.data.length === 0 ? null : (
          <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[0.4375rem] before:w-px before:bg-border">
            {deployments.data.map((deployment) => (
              <li key={deployment.id} className="relative">
                <Link
                  to="/projects/$projectId/deployments/$deploymentId"
                  params={{ projectId, deploymentId: deployment.id }}
                  className="flex items-start gap-4 rounded-lg py-2.5 pr-3 transition-colors hover:bg-surface-raised focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="relative z-10 mt-1.5 size-[0.9375rem] shrink-0 rounded-full border-4 border-card bg-muted-foreground/60"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <DeploymentStatusBadge status={deployment.status} />
                      <span className="font-mono text-sm">
                        {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                      </span>
                      <span className="truncate text-sm">
                        {deployment.commitMessage ?? "sem mensagem"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} ·{" "}
                      {deployment.triggeredByLabel} ·{" "}
                      {formatRelativeTime(deployment.createdAt, now)} ·{" "}
                      {formatDuration(durationBetween(deployment.startedAt, deployment.finishedAt))}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DomainsCard({ details }: { readonly details: ProjectDetails }) {
  const { project, domains } = details;
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <GlobeIcon aria-hidden className="size-4" />
          Domínios
        </CardTitle>
        <Link
          to="/projects/$projectId/domains"
          params={{ projectId: project.id }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Gerenciar
        </Link>
      </CardHeader>
      <CardContent>
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
          <ul className="divide-y">
            {domains.map((domain) => {
              const url = `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
              return (
                <li key={domain.hostname} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {domain.httpsEnabled ? (
                      <LockIcon aria-label="HTTPS" className="size-3.5 shrink-0 text-success" />
                    ) : (
                      <UnlockIcon
                        aria-label="HTTP"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="truncate">{domain.hostname}</span>
                    {domain.automatic ? <StatusPill tone="neutral" label="Automático" /> : null}
                  </span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline"
                  >
                    Abrir
                    <ExternalLinkIcon aria-hidden className="size-3.5" />
                    <span className="sr-only">{domain.hostname} em nova aba</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ContainersCard({ details }: { readonly details: ProjectDetails }) {
  const { project, containers } = details;
  const now = new Date();
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerIcon aria-hidden className="size-4" />
          Contêineres
        </CardTitle>
      </CardHeader>
      <CardContent>
        {containers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contêiner em execução.</p>
        ) : (
          <ul className="divide-y">
            {containers.map((container) => (
              <li
                key={container.containerId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{container.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {container.state === "running"
                      ? `iniciado ${formatRelativeTime(container.startedAt, now)}`
                      : "parado"}
                    {" · "}
                    {pluralize(container.restartCount, "reinício", "reinícios")}
                    {container.deploymentId === project.currentDeploymentId ? " · atual" : ""}
                  </p>
                </div>
                <ContainerStateBadge state={container.state} health={container.health} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ResourcesCard({ projectId }: { readonly projectId: string }) {
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, 1],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours: 1 } }),
    refetchInterval: METRICS_POLL_INTERVAL_IN_MS,
  });
  const samples = metrics.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon aria-hidden className="size-4" />
          Recursos na última hora
        </CardTitle>
        <Link
          to="/projects/$projectId/metrics"
          params={{ projectId }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Ver métricas
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {metrics.data == null ? <Skeleton className="h-64 rounded-lg" /> : null}
        {metrics.data != null && samples.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem amostras ainda. O worker coleta CPU e memória enquanto o contêiner está em execução.
          </p>
        ) : null}
        {samples.length === 0 ? null : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">CPU</p>
              <MetricChart
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
            <div className="space-y-2">
              <p className="text-sm font-medium">Memória</p>
              <MetricChart
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
      </CardContent>
    </Card>
  );
}
