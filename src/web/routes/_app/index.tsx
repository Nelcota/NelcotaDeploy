import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  formatBytes,
  formatLongDate,
  formatPercent,
  formatRelativeTime,
  pluralize,
} from "@/shared/format";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/labels";
import { List, ListRow, Section, type Stat, StatRow } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { SegmentedControl } from "@/web/components/overview";
import { containerAccent } from "@/web/components/project-accent";
import { ErrorState } from "@/web/components/states";
import { ContainerStateBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";
import { usagePercent } from "@/web/components/usage-meter";
import { useCan } from "@/web/components/use-permissions";
import { getDashboardFn, getHostMetricsFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const REFRESH_INTERVAL_IN_MS = 10_000;
const SHORT_SHA_LENGTH = 7;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_DAY = 86_400_000;
const WINDOWS = [
  { value: 1, label: "1 h" },
  { value: HOURS_PER_DAY, label: "24 h" },
] as const;
const SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});

type DashboardSummary = NonNullable<Awaited<ReturnType<typeof getDashboardFn>>>;
type RecentDeployment = DashboardSummary["recentDeployments"][number];

/** The headline: one sentence that says how things are, with the key words in status color. */
function Headline({ data }: { readonly data: DashboardSummary }): ReactNode {
  if (data.worker == null || data.worker.online === false) {
    return (
      <>
        O <span className="text-destructive">worker está parado</span>.
      </>
    );
  }
  if (data.worker.dockerAvailable === false) {
    return (
      <>
        O <span className="text-destructive">Docker está indisponível</span>.
      </>
    );
  }
  if (data.projectCount === 0) {
    return "Nenhuma aplicação ainda.";
  }
  if (data.offlineCount > 0) {
    const verb = data.offlineCount === 1 ? "precisa" : "precisam";
    return (
      <>
        <span className="text-warning">
          {pluralize(data.offlineCount, "aplicação", "aplicações")}
        </span>{" "}
        {verb} de atenção.
      </>
    );
  }
  return (
    <>
      Tudo <span className="text-success">no ar</span>.
    </>
  );
}

function subline(data: DashboardSummary): string {
  if (data.worker == null || data.worker.online === false) {
    return "Deploys e tasks ficam na fila até o worker voltar.";
  }
  if (data.projectCount === 0) {
    return "Crie o primeiro projeto para fazer deploy a partir de um repositório GitHub.";
  }
  const deployed = data.projectCount - data.neverDeployedCount;
  return `${pluralize(data.onlineCount, "aplicação online", "aplicações online")} de ${deployed} com deploy.`;
}

function deploymentsInLastDay(deployments: readonly RecentDeployment[], now: Date): number {
  const since = now.getTime() - MILLISECONDS_PER_DAY;
  return deployments.filter((deployment) => new Date(deployment.createdAt).getTime() >= since)
    .length;
}

function dashboardStats(data: DashboardSummary, now: Date): Stat[] {
  const host = data.hostSample;
  const failures = data.recentFailures.length;
  return [
    {
      label: "Aplicações online",
      value: `${data.onlineCount} de ${data.projectCount - data.neverDeployedCount}`,
      tone: data.offlineCount > 0 ? "warning" : "default",
      detail: data.offlineCount === 0 ? "nenhuma offline" : `${data.offlineCount} offline`,
    },
    {
      label: "Deploys em 24 h",
      value: deploymentsInLastDay(data.recentDeployments, now),
      detail: "entre os mais recentes",
    },
    {
      label: "Falhas em 24 h",
      value: failures,
      tone: failures > 0 ? "danger" : "default",
      detail: failures > 0 ? "veja a atividade" : "nenhuma falha",
    },
    { label: "CPU", value: formatPercent(host?.cpuPercent ?? null), detail: "do servidor" },
    {
      label: "Memória",
      value: formatPercent(usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes)),
      detail:
        host?.memoryTotalBytes == null
          ? "indisponível"
          : `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
    },
  ];
}

function DashboardPage() {
  const can = useCan();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data;
  const now = new Date();

  return (
    <>
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <p className="text-sm font-medium text-muted-foreground first-letter:uppercase">
            {formatLongDate(now)}
          </p>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
            {data == null ? "Carregando…" : <Headline data={data} />}
          </h1>
          <p className="text-base text-muted-foreground">
            {data == null ? "Lendo o estado do servidor." : subline(data)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/deployments">Ver deploys</Link>
          </Button>
          {can("project:write") ? (
            <Button asChild>
              <Link to="/projects/new">
                <PlusIcon aria-hidden />
                Novo projeto
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      {data == null ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <StatRow stats={dashboardStats(data, now)} />
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ApplicationsSection canCreate={can("project:write")} />
        <ActivitySection deployments={data?.recentDeployments ?? null} now={now} />
      </div>

      <ServerSection />
    </>
  );
}

function ApplicationsSection({ canCreate }: { readonly canCreate: boolean }) {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const now = new Date();
  const list = projects.data ?? [];
  return (
    <Section
      title="Aplicações"
      description="Estado do contêiner atual de cada projeto."
      action={
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Todos os projetos
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {projects.isPending ? <Skeleton className="h-40 rounded-xl" /> : null}
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : null}
      {projects.isSuccess ? (
        <List>
          {list.length === 0 ? (
            <ListRow>
              <p className="flex-1 text-sm text-muted-foreground">Nenhuma aplicação ainda.</p>
              {canCreate ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/projects/new">Criar projeto</Link>
                </Button>
              ) : null}
            </ListRow>
          ) : null}
          {list.map((project) => (
            <ListRow
              key={project.id}
              accent={containerAccent(project.containerState, project.containerHealth)}
            >
              <button
                type="button"
                aria-label={`Abrir ${project.name}`}
                onClick={() =>
                  void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })
                }
                className="absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{project.name}</p>
                <p className="truncate font-mono text-xs text-faint">
                  {project.repositoryFullName}
                </p>
              </div>
              <p className="hidden shrink-0 text-xs text-faint sm:block">
                {project.latestDeployment == null
                  ? "sem deploy"
                  : `deploy ${formatRelativeTime(project.latestDeployment.createdAt, now)}`}
              </p>
              <div className="w-36 shrink-0 text-right">
                <ContainerStateBadge
                  state={project.containerState}
                  health={project.containerHealth}
                />
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}
    </Section>
  );
}

const FEED_DOT: Readonly<Record<string, string>> = {
  succeeded: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-faint",
};

function ActivityItem({
  deployment,
  now,
}: {
  readonly deployment: RecentDeployment;
  readonly now: Date;
}) {
  const failed = deployment.status === "failed";
  const sha = deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—";
  return (
    <li>
      <Link
        to="/projects/$projectId/deployments/$deploymentId"
        params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
        className="relative flex gap-4 rounded-lg py-2 pr-2 transition-colors hover:bg-surface-raised/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-background",
            FEED_DOT[deployment.status] ?? "animate-pulse bg-brand",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium">{deployment.projectName}</span>
            <time dateTime={deployment.createdAt} className="shrink-0 text-xs text-faint">
              {formatRelativeTime(deployment.createdAt, now)}
            </time>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="font-mono">{sha}</span>
            {" · "}
            {deployment.commitMessage ?? "sem mensagem"}
          </span>
          {failed ? (
            <span className="block truncate text-xs text-destructive">
              {DEPLOYMENT_STATUS_LABELS.failed}
              {deployment.errorMessage == null ? "" : ` · ${deployment.errorMessage}`}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function ActivitySection({
  deployments,
  now,
}: {
  readonly deployments: readonly RecentDeployment[] | null;
  readonly now: Date;
}) {
  return (
    <Section title="Atividade" description="Deploys mais recentes.">
      {deployments == null ? <Skeleton className="h-40 rounded-xl" /> : null}
      {deployments?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum deploy ainda.</p>
      ) : null}
      {deployments == null || deployments.length === 0 ? null : (
        <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-1 before:w-px before:bg-border">
          {deployments.map((deployment) => (
            <ActivityItem key={deployment.id} deployment={deployment} now={now} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function ServerSection() {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<(typeof SERIES)[number]["value"]>("cpu");
  const hostMetrics = useQuery({
    queryKey: ["host-metrics", hours],
    queryFn: () => getHostMetricsFn({ data: { hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const selected = SERIES.find((item) => item.value === series) ?? SERIES[0];
  return (
    <Section
      title="Servidor"
      description={hours === 1 ? "Uso na última hora." : "Uso nas últimas 24 horas."}
      action={
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Série"
            options={SERIES.map((item) => ({ value: item.value, label: item.label }))}
            value={series}
            onChange={setSeries}
          />
          <SegmentedControl
            label="Janela de tempo"
            options={WINDOWS}
            value={hours}
            onChange={setHours}
          />
        </div>
      }
    >
      <Card className="py-5">
        <CardContent className="px-5">
          {hostMetrics.data == null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <MetricChart
              label={selected.label}
              colorVariable={selected.color}
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
    </Section>
  );
}
