import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  BoxIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  HistoryIcon,
  RocketIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatBytes, formatPercent, formatRelativeTime, formatShortTime } from "@/shared/format";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CONTAINER_STATE_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { CardTitleRow, StatusTile } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { SegmentedControl } from "@/web/components/overview";
import { currentContainer } from "@/web/components/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/project-query";
import { ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getDeploymentFn, listDeploymentsFn } from "@/web/functions/deployments.functions";
import { getProjectMetricsFn } from "@/web/functions/monitoring.functions";

const SHORT_SHA_LENGTH = 7;
const RECENT_DEPLOYMENTS = 6;
const ACTIVE_POLL_INTERVAL_IN_MS = 5000;
const IDLE_POLL_INTERVAL_IN_MS = 30_000;
const METRICS_POLL_INTERVAL_IN_MS = 30_000;
const HOURS_PER_DAY = 24;
const WINDOWS = [
  { value: 1, label: "Última hora" },
  { value: HOURS_PER_DAY, label: "24 horas" },
] as const;
const SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;

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
    <div className="space-y-6">
      <SituationCard details={data} latest={recent.data?.[0] ?? null} />
      {/* Both rows share one three-column grid so card edges line up. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ResourcesCard projectId={projectId} />
        </div>
        <RecentDeploymentsCard projectId={projectId} deployments={recent.data ?? null} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <AddressesCard details={data} />
        <ContainerCard details={data} />
        <ConfigurationCard details={data} />
      </div>
    </div>
  );
}

/** The five figures that tell whether the application is serving the latest code. */
function SituationCard({
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
  const healthy = running && container.health !== "unhealthy";
  const restarts = container?.restartCount ?? 0;
  const startedAt = running ? (container.startedAt ?? null) : null;
  const sha = current.data?.commitSha ?? null;

  let statusIcon = CircleDashedIcon;
  let statusColor = "";
  if (container != null) {
    statusIcon = healthy ? CircleCheckIcon : CircleAlertIcon;
    statusColor = healthy ? "text-success" : "text-warning";
  }

  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={ActivityIcon} title="Situação atual" />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatusTile
          value={
            container == null
              ? "Sem contêiner"
              : (CONTAINER_STATE_LABELS[container.state] ?? container.state)
          }
          detail={container?.health == null ? undefined : `saúde: ${container.health}`}
          label="Contêiner"
          icon={statusIcon}
          iconClassName={statusColor}
        />
        <StatusTile
          value={latest == null ? "—" : DEPLOYMENT_STATUS_LABELS[latest.status]}
          detail={latest == null ? "nenhum ainda" : formatRelativeTime(latest.createdAt, now)}
          label="Último deploy"
          icon={RocketIcon}
          iconClassName={latest?.status === "failed" ? "text-destructive" : ""}
          tone={latest?.status === "failed" ? "danger" : "default"}
        />
        <StatusTile
          value={<span className="font-mono">{sha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}</span>}
          detail={current.data?.commitMessage ?? undefined}
          label="Commit no ar"
          icon={GitCommitHorizontalIcon}
        />
        <StatusTile
          value={container == null ? "—" : restarts}
          label="Reinícios"
          icon={RotateCwIcon}
          iconClassName={restarts > 0 ? "text-warning" : ""}
        />
        <StatusTile
          value={startedAt == null ? "—" : formatShortTime(startedAt)}
          detail={startedAt == null ? undefined : formatRelativeTime(startedAt, now)}
          label="No ar desde"
          icon={ClockIcon}
        />
      </dl>
    </Card>
  );
}

function ResourcesCard({ projectId }: { readonly projectId: string }) {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<(typeof SERIES)[number]["value"]>("cpu");
  const metrics = useQuery({
    queryKey: ["project-metrics", projectId, hours],
    queryFn: () => getProjectMetricsFn({ data: { projectId, hours } }),
    refetchInterval: METRICS_POLL_INTERVAL_IN_MS,
  });
  const selected = SERIES.find((item) => item.value === series) ?? SERIES[0];
  const samples = metrics.data ?? [];
  const latest = samples.at(-1) ?? null;
  let current = "—";
  if (latest != null) {
    current =
      series === "cpu" ? formatPercent(latest.cpuPercent) : formatBytes(latest.memoryUsedBytes);
  }
  return (
    <Card className="h-full gap-5 p-5">
      <CardTitleRow icon={ActivityIcon} title="Recursos">
        <SegmentedControl
          label="Janela de tempo"
          options={WINDOWS}
          value={hours}
          onChange={setHours}
        />
      </CardTitleRow>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Série"
          options={SERIES.map((item) => ({ value: item.value, label: item.label }))}
          value={series}
          onChange={setSeries}
        />
        <p className="text-sm text-muted-foreground">
          Agora <span className="font-medium text-foreground tabular-nums">{current}</span>
          {" · "}
          <Link
            to="/projects/$projectId/metrics"
            params={{ projectId }}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver métricas
          </Link>
        </p>
      </div>
      {metrics.data == null ? <Skeleton className="h-64 rounded-lg" /> : null}
      {metrics.data != null && samples.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sem amostras ainda. CPU e memória aparecem enquanto o contêiner roda.
        </p>
      ) : null}
      {samples.length === 0 ? null : (
        <MetricChart
          label={selected.label}
          colorVariable={selected.color}
          {...(series === "cpu" ? { maxValue: 100 } : {})}
          formatValue={(value) => (series === "cpu" ? `${Math.round(value)}%` : formatBytes(value))}
          points={samples.map((sample) => ({
            createdAt: sample.createdAt,
            value: series === "cpu" ? sample.cpuPercent : sample.memoryUsedBytes,
          }))}
        />
      )}
    </Card>
  );
}

function RecentDeploymentsCard({
  projectId,
  deployments,
}: {
  readonly projectId: string;
  readonly deployments: readonly RecentDeployment[] | null;
}) {
  const now = new Date();
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={HistoryIcon} title="Deploys recentes">
        <Link
          to="/projects/$projectId/deployments"
          params={{ projectId }}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver todos
        </Link>
      </CardTitleRow>
      {deployments == null ? <Skeleton className="h-60 rounded-lg" /> : null}
      {deployments?.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum deploy ainda. Use o botão Deploy acima para publicar a primeira versão.
        </p>
      ) : null}
      {deployments == null || deployments.length === 0 ? null : (
        <ul className="-mx-2 divide-y divide-border">
          {deployments.map((deployment) => (
            <li key={deployment.id}>
              <Link
                to="/projects/$projectId/deployments/$deploymentId"
                params={{ projectId, deploymentId: deployment.id }}
                className="flex items-start justify-between gap-4 px-2 py-3 transition-colors hover:bg-well/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    <span className="font-mono font-medium">
                      {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                    </span>{" "}
                    {deployment.commitMessage ?? "sem mensagem"}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} · {deployment.triggeredByLabel}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <DeploymentStatusBadge status={deployment.status} />
                  <time dateTime={deployment.createdAt} className="text-xs text-faint">
                    {formatRelativeTime(deployment.createdAt, now)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const CARD_LINK =
  "text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none";

/** A label and its value on one line; long values wrap instead of being cut. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-0.5 py-2.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

function AddressesCard({ details }: { readonly details: ProjectDetails }) {
  const { project, domains } = details;
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={GlobeIcon} title="Endereços" count={domains.length}>
        <Link
          to="/projects/$projectId/domains"
          params={{ projectId: project.id }}
          className={CARD_LINK}
        >
          Gerenciar
        </Link>
      </CardTitleRow>
      {domains.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">
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
        <ul className="divide-y divide-border">
          {domains.map((domain) => {
            const url = `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
            return (
              <li key={domain.hostname} className="flex items-center justify-between gap-3 py-2.5">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex min-w-0 items-center gap-2 font-mono text-sm"
                >
                  <span className="break-all group-hover:underline">{domain.hostname}</span>
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
    </Card>
  );
}

function ContainerCard({ details }: { readonly details: ProjectDetails }) {
  const container = currentContainer(details);
  const others = details.containers.length - (container == null ? 0 : 1);
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={BoxIcon} title="Contêiner" />
      {container == null ? (
        <p className="py-2.5 text-sm text-muted-foreground">Nenhum contêiner em execução.</p>
      ) : (
        <dl className="divide-y divide-border">
          <Fact label="Nome">
            <span className="font-mono">{container.name}</span>
          </Fact>
          <Fact label="Imagem">
            <span className="font-mono">{container.image}</span>
          </Fact>
          {others > 0 ? (
            <Fact label="Outros">
              {others === 1 ? "1 contêiner antigo" : `${others} contêineres antigos`}
            </Fact>
          ) : null}
        </dl>
      )}
    </Card>
  );
}

function ConfigurationCard({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={SlidersHorizontalIcon} title="Configuração">
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId: project.id }}
          className={CARD_LINK}
        >
          Editar
        </Link>
      </CardTitleRow>
      <dl className="divide-y divide-border">
        <Fact label="Dockerfile">
          <span className="font-mono">{project.dockerfilePath}</span>
        </Fact>
        <Fact label="Porta interna">{project.internalPort}</Fact>
        <Fact label="Verificação de saúde">
          {project.healthCheckPath == null ? "Conexão TCP" : `HTTP ${project.healthCheckPath}`}
        </Fact>
        <Fact label="Deploy">{project.autoDeploy ? "Automático a cada push" : "Manual"}</Fact>
      </dl>
    </Card>
  );
}
