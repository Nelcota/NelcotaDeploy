import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  BoxesIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  HistoryIcon,
  ListIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
} from "lucide-react";
import { useState } from "react";

import { formatPercent, formatRelativeTime } from "@/shared/format";
import { CardTitleRow, List, StatusTile, TEXT_LINK } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { SegmentedControl } from "@/web/components/overview";
import { type ApplicationFilter, matchesApplicationFilter } from "@/web/components/project-accent";
import { ProjectListRow } from "@/web/components/project-list-row";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { describeSystemStatus, SYSTEM_STATUS_DOTS } from "@/web/components/system-status";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";
import { usagePercent } from "@/web/components/usage-meter";
import { useCan } from "@/web/components/use-permissions";
import {
  getDashboardFn,
  getHostMetricsFn,
  getSidebarStatusFn,
} from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const REFRESH_INTERVAL_IN_MS = 10_000;
const SHORT_SHA_LENGTH = 7;
const HOURS_PER_DAY = 24;
const WINDOWS = [
  { value: 1, label: "Última hora" },
  { value: HOURS_PER_DAY, label: "24 horas" },
] as const;
const SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;
const APPLICATION_FILTERS: readonly {
  readonly value: ApplicationFilter;
  readonly label: string;
  readonly icon: LucideIcon | null;
}[] = [
  { value: "all", label: "Todas", icon: null },
  { value: "online", label: "Online", icon: CircleCheckIcon },
  { value: "attention", label: "Precisam de atenção", icon: CircleAlertIcon },
  { value: "never-deployed", label: "Sem deploy", icon: CircleDashedIcon },
];

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});

type DashboardSummary = NonNullable<Awaited<ReturnType<typeof getDashboardFn>>>;
type RecentDeployment = DashboardSummary["recentDeployments"][number];
type HostSample = Awaited<ReturnType<typeof getHostMetricsFn>>[number];

function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  const data = dashboard.data ?? null;
  const now = new Date();

  return (
    <>
      <h1 className="sr-only">Painel</h1>
      <OverviewCard data={data} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ServerCard />
        <ActivityCard data={data} now={now} />
      </div>
      <ApplicationsCard />
    </>
  );
}

function WorkerPill() {
  const status = useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  // Deploys in progress already have their own tile here, so the pill only tells the health.
  const { label, tone } = describeSystemStatus({
    pending: status.isPending,
    failed: status.isError,
    worker: status.data?.worker ?? null,
    activeDeployments: 0,
  });
  return (
    <Link
      to="/settings"
      search={{ tab: "server" }}
      className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm ring-1 ring-border transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ServerIcon aria-hidden className="size-4 text-muted-foreground" />
      {label}
      <span aria-hidden className={cn("size-2 rounded-full", SYSTEM_STATUS_DOTS[tone])} />
    </Link>
  );
}

/** Top card: how many applications there are, and the state of each group at a glance. */
function OverviewCard({ data }: { readonly data: DashboardSummary | null }) {
  const status = useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const active = status.data?.activeDeployments ?? 0;
  if (data == null) {
    return <Skeleton className="h-52 rounded-2xl" />;
  }
  // Same rule as the "Precisam de atenção" filter: down, or running but failing its check.
  const attention = data.offlineCount + data.unhealthyCount;
  return (
    <Card className="gap-4 p-5">
      <div className="flex min-w-0 flex-col gap-4">
        <CardTitleRow icon={ActivityIcon} title="Status das aplicações" count={data.projectCount}>
          <WorkerPill />
        </CardTitleRow>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatusTile
            value={data.onlineCount}
            label="Online"
            icon={CircleCheckIcon}
            iconClassName={data.onlineCount > 0 ? "text-success" : ""}
          />
          <StatusTile
            value={attention}
            label="Precisam de atenção"
            icon={CircleAlertIcon}
            iconClassName={attention > 0 ? "text-warning" : ""}
          />
          <StatusTile value={data.neverDeployedCount} label="Sem deploy" icon={CircleDashedIcon} />
          <StatusTile
            value={data.deploymentsLastDayCount}
            label="Deploys em 24\u00a0h"
            icon={RocketIcon}
          />
          <StatusTile
            value={active}
            label="Em andamento"
            icon={LoaderCircleIcon}
            iconClassName={active > 0 ? "text-brand" : ""}
            tone={active > 0 ? "progress" : "default"}
          />
          <StatusTile
            value={data.failuresLastDayCount}
            label="Falhas em 24\u00a0h"
            icon={CircleXIcon}
            iconClassName={data.failuresLastDayCount > 0 ? "text-destructive" : ""}
            tone={data.failuresLastDayCount > 0 ? "danger" : "default"}
          />
        </dl>
      </div>
    </Card>
  );
}

function ServerCard() {
  const [hours, setHours] = useState<number>(1);
  const [series, setSeries] = useState<(typeof SERIES)[number]["value"]>("cpu");
  const hostMetrics = useQuery({
    queryKey: ["host-metrics", hours],
    queryFn: () => getHostMetricsFn({ data: { hours } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const selected = SERIES.find((item) => item.value === series) ?? SERIES[0];
  const samples: readonly HostSample[] = hostMetrics.data ?? [];
  const latest = samples.at(-1);
  const latestValue =
    series === "cpu"
      ? (latest?.cpuPercent ?? null)
      : usagePercent(latest?.memoryUsedBytes, latest?.memoryTotalBytes);
  return (
    <Card className="gap-5 p-5">
      <CardTitleRow icon={ServerIcon} title="Servidor">
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
          Agora{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatPercent(latestValue)}
          </span>
        </p>
      </div>
      {hostMetrics.isError ? (
        <ErrorState error={hostMetrics.error} onRetry={() => void hostMetrics.refetch()} />
      ) : null}
      {hostMetrics.isPending ? <Skeleton className="h-64 rounded-lg" /> : null}
      {hostMetrics.data == null ? null : (
        <MetricChart
          label={selected.label}
          colorVariable={selected.color}
          maxValue={100}
          formatValue={(value) => `${Math.round(value)}%`}
          points={samples.map((sample) => ({
            createdAt: sample.createdAt,
            value:
              series === "cpu"
                ? sample.cpuPercent
                : usagePercent(sample.memoryUsedBytes, sample.memoryTotalBytes),
          }))}
        />
      )}
    </Card>
  );
}

function ActivityRow({
  deployment,
  now,
}: {
  readonly deployment: RecentDeployment;
  readonly now: Date;
}) {
  const sha = deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—";
  return (
    <li>
      <Link
        to="/projects/$projectId/deployments/$deploymentId"
        params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
        className="flex items-start justify-between gap-4 px-2 py-3 transition-colors hover:bg-well/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{deployment.projectName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="font-mono">{sha}</span> · {deployment.commitMessage ?? "sem mensagem"}
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
  );
}

function ActivityCard({
  data,
  now,
}: {
  readonly data: DashboardSummary | null;
  readonly now: Date;
}) {
  const [view, setView] = useState<"recent" | "failed">("recent");
  const recent = data?.recentDeployments ?? [];
  const failed = data?.recentFailures ?? [];
  const list = view === "recent" ? recent : failed;
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={HistoryIcon} title="Atividade">
        <Link to="/deployments" className={TEXT_LINK}>
          Ver todos
        </Link>
      </CardTitleRow>
      <SegmentedControl
        label="Atividade"
        options={[
          { value: "recent", label: "Recentes" },
          {
            value: "failed",
            label:
              data == null
                ? "Falhas em 24\u00a0h"
                : `Falhas em 24\u00a0h (${data.failuresLastDayCount})`,
          },
        ]}
        value={view}
        onChange={setView}
      />
      {data == null ? <Skeleton className="h-60 rounded-lg" /> : null}
      {data != null && list.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title={view === "recent" ? "Nenhum deploy ainda" : "Nenhuma falha nas últimas 24 horas"}
        />
      ) : null}
      {list.length === 0 ? null : (
        <ul className="-mx-2 max-h-80 divide-y divide-border overflow-y-auto">
          {list.map((deployment) => (
            <ActivityRow key={deployment.id} deployment={deployment} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ApplicationsCard() {
  const can = useCan();
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const now = new Date();
  const all = projects.data ?? [];
  const list = all.filter((project) =>
    matchesApplicationFilter(filter, project.containerState, project.containerHealth),
  );
  return (
    <Card className="gap-5 p-5">
      <CardTitleRow
        icon={ListIcon}
        title="Todas as aplicações"
        count={projects.data == null ? null : all.length}
      >
        <Link to="/projects" className={TEXT_LINK}>
          Ver todos
        </Link>
        {can("project:write") ? (
          <Button size="sm" asChild>
            <Link to="/projects/new">
              <PlusIcon aria-hidden />
              Novo projeto
            </Link>
          </Button>
        ) : null}
      </CardTitleRow>
      <div
        role="radiogroup"
        aria-label="Filtrar aplicações"
        className="-m-1 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
      >
        {APPLICATION_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === filter}
            onClick={() => setFilter(option.value)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              option.value === filter
                ? "bg-primary text-primary-foreground"
                : "bg-well ring-1 ring-border hover:bg-well-hover",
            )}
          >
            {option.icon == null ? null : <option.icon aria-hidden className="size-4" />}
            {option.label}
          </button>
        ))}
      </div>
      {projects.isPending ? <ListSkeleton rows={3} /> : null}
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : null}
      {projects.data != null && all.length === 0 ? (
        <EmptyState
          icon={BoxesIcon}
          title="Nenhuma aplicação ainda"
          description="Conecte um repositório para fazer o primeiro deploy."
          action={
            can("project:write") ? (
              <Button size="sm" asChild>
                <Link to="/projects/new">
                  <PlusIcon aria-hidden />
                  Novo projeto
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {all.length > 0 && list.length === 0 ? (
        <EmptyState
          icon={ListIcon}
          title="Nenhuma aplicação neste filtro"
          action={
            <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
              Limpar filtro
            </Button>
          }
        />
      ) : null}
      {list.length === 0 ? null : (
        <List>
          {list.map((project) => (
            <ProjectListRow key={project.id} project={project} now={now} />
          ))}
        </List>
      )}
    </Card>
  );
}
