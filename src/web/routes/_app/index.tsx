import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  BoxesIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  ListIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatPercent, formatRelativeTime } from "@/shared/format";
import { MetricChart } from "@/web/components/metric-chart";
import { SegmentedControl } from "@/web/components/overview";
import { type ApplicationFilter, matchesApplicationFilter } from "@/web/components/project-accent";
import { ErrorState } from "@/web/components/states";
import { ContainerStateBadge, DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
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
const MILLISECONDS_PER_DAY = 86_400_000;
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

function deploymentsInLastDay(deployments: readonly RecentDeployment[], now: Date): number {
  const since = now.getTime() - MILLISECONDS_PER_DAY;
  return deployments.filter((deployment) => new Date(deployment.createdAt).getTime() >= since)
    .length;
}

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
      <OverviewCard data={data} now={now} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ServerCard />
        <ActivityCard data={data} now={now} />
      </div>
      <ApplicationsCard />
    </>
  );
}

/** Title row shared by the dashboard cards: icon, title, optional count and actions. */
function CardTitleRow({
  icon: Icon,
  title,
  count,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly count?: number | null;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-base font-semibold">
        <Icon aria-hidden className="size-[1.15rem] text-muted-foreground" />
        {title}
        {count == null ? null : (
          <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {children == null ? null : (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

const TILE_TONES = {
  default: "bg-well ring-border/70",
  progress: "bg-primary/25 ring-primary/30",
  danger: "bg-destructive/20 ring-destructive/30",
} as const;

function StatusTile({
  value,
  label,
  icon: Icon,
  iconClassName,
  tone = "default",
}: {
  readonly value: ReactNode;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
  readonly tone?: keyof typeof TILE_TONES;
}) {
  return (
    <div
      className={cn(
        "flex min-h-28 min-w-0 flex-col justify-between gap-4 rounded-xl p-4 ring-1",
        TILE_TONES[tone],
      )}
    >
      <dd className="text-2xl leading-none font-semibold tabular-nums">{value}</dd>
      <dt className="flex min-w-0 items-center gap-2 text-sm leading-tight text-muted-foreground">
        <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName)} />
        <span>{label}</span>
      </dt>
    </div>
  );
}

function WorkerPill() {
  const status = useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const worker = status.data?.worker ?? null;
  const healthy = worker?.online === true && worker.dockerAvailable;
  let label = "Worker ativo";
  if (worker == null || worker.online === false) {
    label = "Worker parado";
  } else if (worker.dockerAvailable === false) {
    label = "Docker indisponível";
  }
  return (
    <Link
      to="/settings"
      search={{ tab: "server" }}
      className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm ring-1 ring-border transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ServerIcon aria-hidden className="size-4 text-muted-foreground" />
      {label}
      <span
        aria-hidden
        className={cn("size-2 rounded-full", healthy ? "bg-success" : "bg-destructive")}
      />
    </Link>
  );
}

/** Top card: how many applications there are, and the state of each group at a glance. */
function OverviewCard({
  data,
  now,
}: {
  readonly data: DashboardSummary | null;
  readonly now: Date;
}) {
  const status = useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const active = status.data?.activeDeployments ?? 0;
  if (data == null) {
    return <Skeleton className="h-52 rounded-2xl" />;
  }
  return (
    <Card className="grid gap-6 p-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-0">
      <div className="flex flex-col gap-3 lg:border-r lg:border-border lg:pr-6">
        <CardTitleRow icon={BoxesIcon} title="Aplicações" />
        <p className="text-sm text-muted-foreground">Todos os projetos</p>
        <p className="text-5xl leading-none font-semibold tabular-nums">{data.projectCount}</p>
        <p className="mt-auto text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{data.onlineCount}</span> online agora
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:pl-6">
        <CardTitleRow icon={ActivityIcon} title="Status das aplicações">
          <WorkerPill />
        </CardTitleRow>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          <StatusTile
            value={data.onlineCount}
            label="Online"
            icon={CircleCheckIcon}
            iconClassName="text-success"
          />
          <StatusTile
            value={data.offlineCount}
            label="Fora do ar"
            icon={CircleAlertIcon}
            iconClassName={data.offlineCount > 0 ? "text-warning" : ""}
          />
          <StatusTile value={data.neverDeployedCount} label="Sem deploy" icon={CircleDashedIcon} />
          <StatusTile
            value={deploymentsInLastDay(data.recentDeployments, now)}
            label="Deploys em 24 h"
            icon={GitCommitHorizontalIcon}
          />
          <StatusTile
            value={active}
            label="Em andamento"
            icon={LoaderCircleIcon}
            iconClassName="text-brand"
            tone="progress"
          />
          <StatusTile
            value={data.recentFailures.length}
            label="Falhas em 24 h"
            icon={CircleXIcon}
            iconClassName="text-destructive"
            tone="danger"
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
      {hostMetrics.data == null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
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
        <Link
          to="/deployments"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver todos
        </Link>
      </CardTitleRow>
      <SegmentedControl
        label="Atividade"
        options={[
          { value: "recent", label: `Recentes (${recent.length})` },
          { value: "failed", label: `Falhas em 24 h (${failed.length})` },
        ]}
        value={view}
        onChange={setView}
      />
      {data == null ? <Skeleton className="h-60 rounded-lg" /> : null}
      {data != null && list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {view === "recent" ? "Nenhum deploy ainda." : "Nenhuma falha nas últimas 24 horas."}
        </p>
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
  const navigate = useNavigate();
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
        title="Aplicações"
        count={projects.data == null ? null : all.length}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects">Ver todos os projetos</Link>
        </Button>
        {can("project:write") ? (
          <Button size="sm" asChild>
            <Link to="/projects/new">
              <PlusIcon aria-hidden />
              Novo projeto
            </Link>
          </Button>
        ) : null}
      </CardTitleRow>
      <div role="radiogroup" aria-label="Filtrar aplicações" className="flex flex-wrap gap-2">
        {APPLICATION_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === filter}
            onClick={() => setFilter(option.value)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
      {projects.isPending ? <Skeleton className="h-40 rounded-lg" /> : null}
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : null}
      {projects.isSuccess && list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {all.length === 0 ? "Nenhuma aplicação ainda." : "Nenhuma aplicação neste filtro."}
        </p>
      ) : null}
      {list.length === 0 ? null : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aplicação</TableHead>
              <TableHead className="hidden md:table-cell">Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Último deploy</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((project) => (
              <TableRow
                key={project.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })
                }
              >
                <TableCell className="max-w-0 min-w-48">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="block truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {project.name}
                  </Link>
                  <span className="block truncate font-mono text-xs text-faint">
                    {project.repositoryFullName}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <GitBranchIcon aria-hidden className="size-3.5" />
                    {project.branch}
                  </span>
                </TableCell>
                <TableCell>
                  <ContainerStateBadge
                    state={project.containerState}
                    health={project.containerHealth}
                  />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {project.latestDeployment == null ? (
                    <span className="text-sm text-faint">sem deploy</span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {project.latestDeployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                  {project.latestDeployment == null
                    ? "—"
                    : formatRelativeTime(project.latestDeployment.createdAt, now)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
