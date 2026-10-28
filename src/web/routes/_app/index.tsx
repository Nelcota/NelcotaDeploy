import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BoxesIcon,
  CpuIcon,
  GitBranchIcon,
  HistoryIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  formatBytes,
  formatLongDate,
  formatPercent,
  formatRelativeTime,
  pluralize,
} from "@/shared/format";
import { NelcotaMark } from "@/web/components/brand-logo";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/labels";
import { ListRow, type Stat, StatRow } from "@/web/components/layout";
import { MetricChart } from "@/web/components/metric-chart";
import { bucketAverages, bucketCounts, MiniBars, RatioBlocks } from "@/web/components/mini-bars";
import { SegmentedControl } from "@/web/components/overview";
import { PageHeader } from "@/web/components/page-header";
import {
  type ApplicationFilter,
  containerAccent,
  matchesApplicationFilter,
} from "@/web/components/project-accent";
import { ErrorState } from "@/web/components/states";
import { ContainerStateBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardWell,
} from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { usagePercent } from "@/web/components/usage-meter";
import { useCan } from "@/web/components/use-permissions";
import { getDashboardFn, getHostMetricsFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const REFRESH_INTERVAL_IN_MS = 10_000;
const SHORT_SHA_LENGTH = 7;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
/** Bars of the small charts in the stat cards. */
const STAT_BUCKETS = 8;
const WINDOWS = [
  { value: "1", hours: 1, label: "Última hora" },
  { value: "24", hours: HOURS_PER_DAY, label: "Últimas 24 h" },
] as const;
const SERIES = [
  { value: "cpu", label: "CPU", color: "--chart-1" },
  { value: "memory", label: "Memória", color: "--chart-2" },
] as const;
const APPLICATION_FILTERS: readonly {
  readonly value: ApplicationFilter;
  readonly label: string;
}[] = [
  { value: "all", label: "Todas" },
  { value: "online", label: "Online" },
  { value: "attention", label: "Atenção" },
  { value: "never-deployed", label: "Sem deploy" },
];

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Painel · Nelcota Deploy" }] }),
  component: DashboardPage,
});

type DashboardSummary = NonNullable<Awaited<ReturnType<typeof getDashboardFn>>>;
type RecentDeployment = DashboardSummary["recentDeployments"][number];
type HostSample = Awaited<ReturnType<typeof getHostMetricsFn>>[number];

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

function dashboardStats(
  data: DashboardSummary,
  hostSamples: readonly HostSample[],
  hours: number,
  now: Date,
): Stat[] {
  const host = data.hostSample;
  const failures = data.recentFailures.length;
  const deployed = data.projectCount - data.neverDeployedCount;
  const cpuBars = bucketAverages(
    hostSamples.map((sample) => ({ createdAt: sample.createdAt, value: sample.cpuPercent })),
    now,
    hours * MILLISECONDS_PER_HOUR,
    STAT_BUCKETS,
  );
  const memoryPercent = formatPercent(usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes));
  return [
    {
      label: "Aplicações online",
      icon: BoxesIcon,
      value: `${data.onlineCount} de ${deployed}`,
      tone: data.offlineCount > 0 ? "warning" : "default",
      detail: data.offlineCount === 0 ? "nenhuma offline" : `${data.offlineCount} offline`,
      visual:
        deployed === 0 ? null : (
          <RatioBlocks filled={data.onlineCount} total={deployed} colorVariable="--success" />
        ),
    },
    {
      label: "Deploys em 24 h",
      icon: RocketIcon,
      value: deploymentsInLastDay(data.recentDeployments, now),
      detail: "entre os mais recentes",
      visual: (
        <MiniBars
          values={bucketCounts(
            data.recentDeployments.map((deployment) => deployment.createdAt),
            now,
            MILLISECONDS_PER_DAY,
            STAT_BUCKETS,
          )}
          colorVariable="--chart-4"
        />
      ),
    },
    {
      label: "Falhas em 24 h",
      icon: TriangleAlertIcon,
      value: failures,
      tone: failures > 0 ? "danger" : "default",
      detail: failures > 0 ? "veja a atividade" : "nenhuma falha",
      visual: (
        <MiniBars
          values={bucketCounts(
            data.recentFailures.map((deployment) => deployment.createdAt),
            now,
            MILLISECONDS_PER_DAY,
            STAT_BUCKETS,
          )}
          colorVariable="--chart-5"
        />
      ),
    },
    {
      label: "CPU do servidor",
      icon: CpuIcon,
      value: formatPercent(host?.cpuPercent ?? null),
      detail:
        host?.memoryTotalBytes == null
          ? "memória indisponível"
          : `memória ${memoryPercent} · ${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
      visual: <MiniBars values={cpuBars} colorVariable="--chart-3" />,
    },
  ];
}

function DashboardPage() {
  const can = useCan();
  const [windowValue, setWindowValue] = useState<(typeof WINDOWS)[number]["value"]>("1");
  const selectedWindow = WINDOWS.find((item) => item.value === windowValue) ?? WINDOWS[0];
  const hours = selectedWindow.hours;
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

  return (
    <>
      <PageHeader
        title="Painel"
        description={<span className="first-letter:uppercase">{formatLongDate(now)}</span>}
        actions={
          <>
            <Select
              value={windowValue}
              onValueChange={(value) => {
                const next = WINDOWS.find((item) => item.value === value);
                if (next != null) {
                  setWindowValue(next.value);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Janela de tempo do servidor"
                className="rounded-xl bg-foreground font-medium text-background ring-0 hover:bg-foreground/90 [&_svg:not([class*='text-'])]:text-background"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {WINDOWS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {can("project:write") ? (
              <Button size="sm" asChild>
                <Link to="/projects/new">
                  <PlusIcon aria-hidden />
                  Novo projeto
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatusBanner data={data ?? null} />

      {data == null ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <StatRow stats={dashboardStats(data, hostMetrics.data ?? [], hours, now)} />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ApplicationsCard canCreate={can("project:write")} />
        <ActivityCard deployments={data?.recentDeployments ?? null} now={now} />
      </div>

      <ServerCard samples={hostMetrics.data ?? null} hours={hours} />
    </>
  );
}

/** Small square holding a card's icon, as in the reference panels. */
function CardIcon({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-well text-muted-foreground ring-1 ring-border/60 [&_svg]:size-4">
      {children}
    </span>
  );
}

/** One line on how things are, with the brand emblem and a way to the deploy history. */
function StatusBanner({ data }: { readonly data: DashboardSummary | null }) {
  return (
    <section
      aria-label="Resumo"
      className="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-border/70 sm:flex-row sm:items-center sm:gap-5 sm:px-5"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-well ring-1 ring-border/60">
        <NelcotaMark aria-hidden className="h-7 w-auto" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="text-lg leading-tight font-semibold tracking-tight">
          {data == null ? "Carregando…" : <Headline data={data} />}
        </h2>
        <p className="text-sm text-muted-foreground">
          {data == null ? "Lendo o estado do servidor." : subline(data)}
        </p>
      </div>
      <Button variant="outline" asChild className="w-fit rounded-xl">
        <Link to="/deployments">
          Ver deploys
          <ArrowRightIcon aria-hidden />
        </Link>
      </Button>
    </section>
  );
}

function ApplicationsCard({ canCreate }: { readonly canCreate: boolean }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
  const now = new Date();
  const list = (projects.data ?? []).filter((project) =>
    matchesApplicationFilter(filter, project.containerState, project.containerHealth),
  );
  return (
    <Card className="min-w-0 gap-4 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-3">
          <CardIcon>
            <BoxesIcon aria-hidden />
          </CardIcon>
          <h2 className="text-base font-semibold">Aplicações</h2>
          <Link
            to="/projects"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Ver todas
          </Link>
        </div>
        <SegmentedControl
          label="Filtrar aplicações"
          options={APPLICATION_FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <CardContent className="flex flex-col gap-1.5 px-2">
        {projects.isPending ? <Skeleton className="h-64 rounded-xl" /> : null}
        {projects.isError ? (
          <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
        ) : null}
        {projects.isSuccess && list.length === 0 ? (
          <ListRow>
            <p className="flex-1 text-sm text-muted-foreground">
              {filter === "all" ? "Nenhuma aplicação ainda." : "Nenhuma aplicação neste filtro."}
            </p>
            {canCreate && filter === "all" ? (
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
              className="absolute inset-0 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            />
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-sm font-semibold uppercase ring-1 ring-border/70"
            >
              {project.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{project.name}</p>
              <p className="truncate font-mono text-xs text-faint">{project.repositoryFullName}</p>
            </div>
            <p className="hidden w-32 shrink-0 text-sm text-muted-foreground md:block">
              {project.latestDeployment == null
                ? "sem deploy"
                : formatRelativeTime(project.latestDeployment.createdAt, now)}
            </p>
            <span className="hidden w-36 shrink-0 xl:block">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border/70">
                <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{project.branch}</span>
              </span>
            </span>
            <div className="w-36 shrink-0 text-right">
              <ContainerStateBadge
                state={project.containerState}
                health={project.containerHealth}
              />
            </div>
          </ListRow>
        ))}
      </CardContent>
    </Card>
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

function ActivityCard({
  deployments,
  now,
}: {
  readonly deployments: readonly RecentDeployment[] | null;
  readonly now: Date;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base font-semibold">
          <CardIcon>
            <HistoryIcon aria-hidden />
          </CardIcon>
          Atividade
        </CardTitle>
        <CardDescription className="sr-only">Deploys mais recentes.</CardDescription>
        <CardAction>
          <Link
            to="/deployments"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Ver todos
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function ServerCard({
  samples,
  hours,
}: {
  readonly samples: readonly HostSample[] | null;
  readonly hours: number;
}) {
  const [series, setSeries] = useState<(typeof SERIES)[number]["value"]>("cpu");
  const selected = SERIES.find((item) => item.value === series) ?? SERIES[0];
  return (
    <Card className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-3">
          <CardIcon>
            <ServerIcon aria-hidden />
          </CardIcon>
          <div>
            <h2 className="text-base leading-tight font-semibold">Servidor</h2>
            <p className="text-sm text-muted-foreground">
              {hours === 1 ? "Uso na última hora." : "Uso nas últimas 24 horas."}
            </p>
          </div>
        </div>
        <SegmentedControl
          label="Série"
          options={SERIES.map((item) => ({ value: item.value, label: item.label }))}
          value={series}
          onChange={setSeries}
        />
      </div>
      <CardContent className="px-2">
        <CardWell className="p-4">
          {samples == null ? (
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
        </CardWell>
      </CardContent>
    </Card>
  );
}
