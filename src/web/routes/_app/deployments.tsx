import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import {
  dayKey,
  durationBetween,
  formatDateTime,
  formatDayHeading,
  formatDuration,
  formatShortTime,
} from "@/shared/format";
import { DeploymentListRow } from "@/web/components/deployment-row";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { List, ListRow } from "@/web/components/layout";
import { SegmentedControl } from "@/web/components/overview";
import { PageHeader } from "@/web/components/page-header";
import { ErrorState } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;
const ALL_STATUSES = "all";
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

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const status = statusFilter === ALL_STATUSES ? undefined : statusFilter;
  const deployments = useInfiniteQuery({
    queryKey: ["deployments", "all", statusFilter],
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: {
          limit: PAGE_SIZE,
          ...(status == null ? {} : { status }),
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
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Deploys"
        description="Histórico de deploys de todos os projetos, do mais recente ao mais antigo."
        actions={
          <SegmentedControl
            label="Filtrar deploys por status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        }
      />
      {deployments.isError ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : null}
      {deployments.isPending ? <Skeleton className="h-96 rounded-2xl" /> : null}
      {deployments.isSuccess ? (
        <section aria-label="Histórico de deploys" className="space-y-6">
          {rows.length === 0 ? (
            <List>
              <ListRow>
                <p className="text-sm text-muted-foreground">
                  {status == null
                    ? "Nenhum deploy ainda. Eles aparecem aqui assim que forem solicitados."
                    : "Nenhum deploy com este status."}
                </p>
              </ListRow>
            </List>
          ) : null}
          {groups.map(([day, items]) => (
            <DayGroup key={day} heading={formatDayHeading(items[0]?.createdAt ?? "", now)}>
              {items.map((deployment) => (
                <DeploymentHistoryRow key={deployment.id} deployment={deployment} />
              ))}
            </DayGroup>
          ))}
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
      ) : null}
    </>
  );
}

/** One day of history: the day's name, then its deploys on one card. */
function DayGroup({
  heading,
  children,
}: {
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <h2 className="text-sm font-medium text-muted-foreground first-letter:uppercase">
        {heading}
      </h2>
      <List>{children}</List>
    </div>
  );
}

function DeploymentHistoryRow({ deployment }: { readonly deployment: DeploymentItem }) {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  return (
    <DeploymentListRow
      projectId={deployment.projectId}
      deploymentId={deployment.id}
      status={deployment.status}
    >
      <span
        aria-hidden
        className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-well text-sm font-semibold uppercase ring-1 ring-border/70 sm:flex"
      >
        {deployment.projectName.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <Link
            to="/projects/$projectId"
            params={{ projectId: deployment.projectId }}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {deployment.projectName}
          </Link>
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
            className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {sha == null
              ? `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`
              : sha.slice(0, SHORT_SHA_LENGTH)}
          </Link>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {deployment.commitMessage ?? "sem mensagem"}
        </p>
        {/* Small screens drop the status column; the status moves under the commit. */}
        <div className="pt-1.5 sm:hidden">
          <DeploymentStatusBadge status={deployment.status} />
        </div>
      </div>
      <div className="hidden w-44 shrink-0 text-xs md:block">
        <p className="font-mono text-muted-foreground">{deployment.branch}</p>
        <p className="truncate text-faint">
          {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} · {deployment.triggeredByLabel}
        </p>
      </div>
      <div className="w-16 shrink-0 text-right text-xs sm:w-20">
        <time
          dateTime={deployment.createdAt}
          title={formatDateTime(deployment.createdAt)}
          className="block text-muted-foreground tabular-nums"
        >
          {formatShortTime(deployment.createdAt)}
        </time>
        <span className="text-faint tabular-nums">
          {formatDuration(durationBetween(deployment.startedAt, deployment.finishedAt))}
        </span>
      </div>
      <div className="hidden w-36 shrink-0 justify-end sm:flex">
        <DeploymentStatusBadge status={deployment.status} />
      </div>
    </DeploymentListRow>
  );
}
