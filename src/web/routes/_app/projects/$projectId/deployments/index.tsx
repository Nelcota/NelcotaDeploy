import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FilterXIcon, GitBranchIcon, RocketIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { Deployment, DeploymentStatus } from "@/deployments";
import { dayKey, formatDayHeading } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import {
  DeploymentListRow,
  DeploymentMobileMeta,
  DeploymentOriginColumn,
  DeploymentTimingColumn,
} from "@/web/components/deployments/deployment-row";
import { RollbackButton } from "@/web/components/deployments/rollback-button";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
} from "@/web/components/layout/labels";
import { DayHeading, List, LiveBadge } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { listDeploymentsFn, listRollbackCandidatesFn } from "@/web/functions/deployments.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;

export const Route = createFileRoute("/_app/projects/$projectId/deployments/")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: ProjectDeploymentsPage,
});

const ALL_STATUSES = "all";
// Same filters as the global deploys page; in-progress deploys show up under "Todos".
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

function ProjectDeploymentsPage() {
  const now = useNow();
  const { projectId } = Route.useParams();
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const candidates = useQuery({
    queryKey: ["rollback-candidates", projectId],
    queryFn: () => listRollbackCandidatesFn({ data: { projectId } }),
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const deployments = useInfiniteQuery({
    // The prefix stays ["deployments", projectId] so invalidations elsewhere still reach it.
    queryKey: ["deployments", projectId, statusFilter],
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: {
          projectId,
          limit: PAGE_SIZE,
          ...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter }),
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

  const rollbackIds = useMemo(
    () => new Set((candidates.data ?? []).map((candidate) => candidate.id)),
    [candidates.data],
  );
  const currentDeploymentId = project.data?.project.currentDeploymentId ?? null;
  const canRollback = can("deployment:create");
  const rows = useMemo(() => deployments.data?.pages.flat() ?? [], [deployments.data]);
  // Rows arrive newest first, so the day groups keep that order.
  const groups = useMemo(
    () => [...Map.groupBy(rows, (row) => dayKey(row.createdAt) ?? row.createdAt)],
    [rows],
  );
  const isRollbackTarget = (deploymentId: string) =>
    canRollback && rollbackIds.has(deploymentId) && deploymentId !== currentDeploymentId;
  // The rollback column only takes space when at least one listed deploy can be restored.
  const showRollbackColumn = rows.some((row) => isRollbackTarget(row.id));

  const header = (
    <TabHeader
      title="Deploys"
      description="Histórico de builds e publicações deste projeto."
      actions={
        <SegmentedControl
          label="Filtrar deploys por status"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      }
    />
  );
  if (deployments.isError) {
    return (
      <section aria-label="Histórico de deploys" className="space-y-6">
        {header}
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      </section>
    );
  }
  if (deployments.isPending) {
    return (
      <section aria-label="Histórico de deploys" className="space-y-6">
        {header}
        <ListSkeleton rows={6} />
      </section>
    );
  }

  return (
    <section aria-label="Histórico de deploys" className="space-y-6">
      {header}
      {rows.length === 0 && statusFilter === ALL_STATUSES ? (
        <EmptyState
          icon={RocketIcon}
          title="Nenhum deploy ainda"
          description="Use o botão Deploy acima para publicar a primeira versão."
        />
      ) : null}
      {rows.length === 0 && statusFilter !== ALL_STATUSES ? (
        <EmptyState
          icon={FilterXIcon}
          title="Nenhum deploy com este status"
          action={
            <Button variant="outline" size="sm" onClick={() => setStatusFilter(ALL_STATUSES)}>
              Limpar filtro
            </Button>
          }
        />
      ) : null}
      {rows.length === 0 ? null : (
        <List>
          {groups.map(([day, items]) => (
            <Fragment key={day}>
              <DayHeading>{formatDayHeading(items[0]?.createdAt ?? "", now)}</DayHeading>
              {items.map((deployment) => (
                <DeploymentListRow
                  key={deployment.id}
                  projectId={deployment.projectId}
                  deploymentId={deployment.id}
                >
                  <CommitCell
                    deployment={deployment}
                    current={deployment.id === currentDeploymentId}
                  />
                  <DeploymentOriginColumn
                    trigger={deployment.trigger}
                    triggeredBy={deployment.triggeredByLabel}
                  />
                  <DeploymentTimingColumn timing={deployment} />
                  {showRollbackColumn ? (
                    <div className="flex shrink-0 justify-end sm:w-28">
                      {isRollbackTarget(deployment.id) ? (
                        <RollbackButton deployment={deployment} />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex shrink-0 justify-end sm:w-32">
                    <DeploymentStatusBadge status={deployment.status} />
                  </div>
                </DeploymentListRow>
              ))}
            </Fragment>
          ))}
        </List>
      )}
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

function CommitCell({
  deployment,
  current,
}: {
  readonly deployment: Deployment;
  readonly current: boolean;
}) {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
          className="shrink-0 rounded-sm font-mono text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {sha == null
            ? `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`
            : sha.slice(0, SHORT_SHA_LENGTH)}
        </Link>
        <span
          className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground"
          title={deployment.branch}
        >
          <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{deployment.branch}</span>
        </span>
        {current ? <LiveBadge /> : null}
      </div>
      <p
        className="truncate text-sm text-muted-foreground"
        title={deployment.commitMessage ?? undefined}
      >
        {deployment.commitMessage ?? "sem mensagem"}
      </p>
      <DeploymentMobileMeta timing={deployment} />
    </div>
  );
}
