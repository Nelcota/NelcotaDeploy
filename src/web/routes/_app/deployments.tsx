import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BarChart3Icon,
  CircleCheckIcon,
  CircleXIcon,
  GitBranchIcon,
  CalendarDaysIcon,
  FilterXIcon,
  RocketIcon,
  ListIcon,
  TimerIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import { dayKey, formatDayHeading, formatDuration, formatPercent } from "@/shared/format";
import {
  DeploymentListRow,
  DeploymentMobileMeta,
  DeploymentOriginColumn,
  DeploymentTimingColumn,
} from "@/web/components/deployment-row";
import { DeploymentsChart } from "@/web/components/deployments-chart";
import { ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_LABELS } from "@/web/components/labels";
import {
  CardTitleRow,
  DayHeading,
  List,
  LiveBadge,
  type Stat,
  StatRow,
} from "@/web/components/layout";
import { SegmentedControl } from "@/web/components/overview";
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getDeploymentStatsFn, listDeploymentsFn } from "@/web/functions/deployments.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const STATS_REFRESH_INTERVAL_IN_MS = 30_000;
const STATS_DAYS = 7;
const SHORT_SHA_LENGTH = 7;
const ALL_STATUSES = "all";
const ALL_PROJECTS = "all";
// The statuses people look for in a history; the in-progress ones show up under "Todos".
const STATUS_FILTERS = [
  { value: ALL_STATUSES, label: "Todos" },
  { value: "queued", label: DEPLOYMENT_STATUS_LABELS.queued },
  { value: "succeeded", label: "Concluídos" },
  { value: "failed", label: "Falharam" },
  { value: "cancelled", label: "Cancelados" },
] as const satisfies readonly {
  readonly value: DeploymentStatus | typeof ALL_STATUSES;
  readonly label: string;
}[];

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
type DeploymentItem = Awaited<ReturnType<typeof listDeploymentsFn>>[number];
type DeploymentStatsData = Awaited<ReturnType<typeof getDeploymentStatsFn>>;

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  return (
    <>
      <PageHeader title="Deploys" description="Builds e publicações de todos os projetos." />
      <Summary />
      <History />
    </>
  );
}

/** The last seven days of every project: key figures and deploys per day. */
function Summary() {
  const stats = useQuery({
    queryKey: ["deployment-stats", STATS_DAYS],
    queryFn: () => getDeploymentStatsFn({ data: { days: STATS_DAYS } }),
    refetchInterval: STATS_REFRESH_INTERVAL_IN_MS,
  });
  if (stats.isError) {
    return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  }
  if (stats.data == null) {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Beside the chart the tiles only have half the width, so they wrap two per row. */}
      <StatRow
        title="Últimos 7 dias"
        icon={CalendarDaysIcon}
        stats={summaryStats(stats.data)}
        className="xl:[&_dl]:grid-cols-2"
      />
      <Card className="gap-4 p-5">
        <CardTitleRow icon={BarChart3Icon} title="Deploys por dia" />
        <DeploymentsChart days={stats.data.days} />
      </Card>
    </div>
  );
}

function summaryStats(data: DeploymentStatsData): Stat[] {
  return [
    { label: "Deploys", icon: RocketIcon, value: data.total },
    {
      label: "Taxa de sucesso",
      icon: CircleCheckIcon,
      value: data.successRatePercent == null ? "—" : formatPercent(data.successRatePercent),
      detail: `${data.succeeded} concluídos`,
      tone: "success",
    },
    {
      label: "Falharam",
      icon: CircleXIcon,
      value: data.failed,
      tone: data.failed > 0 ? "danger" : "default",
    },
    {
      label: "Duração média",
      icon: TimerIcon,
      value: formatDuration(data.averageDurationInMs),
      detail: "dos concluídos",
    },
  ];
}

/** Every deploy, newest first, split by day, filtered by status and project. */
function History() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const status = statusFilter === ALL_STATUSES ? undefined : statusFilter;
  const projectId = projectFilter === ALL_PROJECTS ? undefined : projectFilter;
  const projects = useQuery({
    queryKey: ["projects", "filter"],
    queryFn: () => listProjectsFn({ data: {} }),
  });
  const deployments = useInfiniteQuery({
    queryKey: ["deployments", "all", statusFilter, projectFilter],
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: {
          limit: PAGE_SIZE,
          ...(status == null ? {} : { status }),
          ...(projectId == null ? {} : { projectId }),
          ...(pageParam == null ? {} : { before: pageParam }),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : (lastPage.at(-1)?.createdAt ?? undefined),
    refetchInterval: (query) => {
      const rows = query.state.data?.pages.flat() ?? [];
      return rows.some((row) => ACTIVE_DEPLOYMENT_STATUSES.has(row.status))
        ? ACTIVE_REFRESH_INTERVAL_IN_MS
        : false;
    },
  });
  const rows = useMemo(() => deployments.data?.pages.flat() ?? [], [deployments.data]);
  // Rows arrive newest first, so the day groups keep that order.
  const groups = useMemo(
    () => [...Map.groupBy(rows, (row) => dayKey(row.createdAt) ?? row.createdAt)],
    [rows],
  );
  const filtered = status != null || projectId != null;
  const now = new Date();

  return (
    <section aria-labelledby="history-title" className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 id="history-title" className="flex items-center gap-3 text-base font-semibold">
          <ListIcon aria-hidden className="size-[1.15rem] text-muted-foreground" />
          Histórico
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger aria-label="Filtrar deploys por projeto" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS}>Todos os projetos</SelectItem>
              {(projects.data ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SegmentedControl
            label="Filtrar deploys por status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>
      {deployments.isError ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : null}
      {deployments.isPending ? <ListSkeleton rows={6} /> : null}
      {deployments.isSuccess && rows.length === 0 && filtered ? (
        <EmptyState
          icon={FilterXIcon}
          title="Nenhum deploy com estes filtros"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter(ALL_STATUSES);
                setProjectFilter(ALL_PROJECTS);
              }}
            >
              Limpar filtros
            </Button>
          }
        />
      ) : null}
      {deployments.isSuccess && rows.length === 0 && filtered === false ? (
        <EmptyState
          icon={RocketIcon}
          title="Nenhum deploy ainda"
          description="Eles aparecem aqui assim que forem solicitados."
        />
      ) : null}
      {deployments.isSuccess && rows.length > 0 ? (
        <List>
          {groups.map(([day, items]) => (
            <Fragment key={day}>
              <DayHeading>{formatDayHeading(items[0]?.createdAt ?? "", now)}</DayHeading>
              {items.map((deployment) => (
                <HistoryRow key={deployment.id} deployment={deployment} />
              ))}
            </Fragment>
          ))}
        </List>
      ) : null}
      {deployments.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={deployments.isFetchingNextPage}
            onClick={() => void deployments.fetchNextPage()}
          >
            {deployments.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function HistoryRow({ deployment }: { readonly deployment: DeploymentItem }) {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  const params = { projectId: deployment.projectId, deploymentId: deployment.id };
  const shortSha =
    sha == null
      ? `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`
      : sha.slice(0, SHORT_SHA_LENGTH);
  return (
    <DeploymentListRow projectId={deployment.projectId} deploymentId={deployment.id}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={params}
            aria-label={`Deploy ${shortSha} de ${deployment.projectName}`}
            className="truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {deployment.projectName}
          </Link>
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
            {shortSha}
          </span>
          {deployment.isLive ? <LiveBadge /> : null}
        </p>
        <p
          className="truncate text-sm text-muted-foreground"
          title={deployment.commitMessage ?? undefined}
        >
          {deployment.commitMessage ?? "sem mensagem"}
        </p>
        <DeploymentMobileMeta shortSha={shortSha} timing={deployment} />
      </div>
      <span className="hidden w-36 shrink-0 items-center gap-1.5 truncate font-mono text-xs text-muted-foreground lg:inline-flex">
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{deployment.branch}</span>
      </span>
      <DeploymentOriginColumn
        trigger={deployment.trigger}
        triggeredBy={deployment.triggeredByLabel}
      />
      <DeploymentTimingColumn timing={deployment} />
      <div className="flex shrink-0 justify-end sm:w-32">
        <DeploymentStatusBadge status={deployment.status} />
      </div>
    </DeploymentListRow>
  );
}
