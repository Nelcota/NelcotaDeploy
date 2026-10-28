import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RocketIcon, RotateCcwIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { Deployment, DeploymentStatus } from "@/deployments";
import {
  dayKey,
  durationBetween,
  formatDateTime,
  formatDayHeading,
  formatDuration,
  formatShortTime,
} from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { DeploymentListRow } from "@/web/components/deployment-row";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/labels";
import { DayHeading, List, ListRow, LiveBadge } from "@/web/components/layout";
import { SegmentedControl } from "@/web/components/overview";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { DeploymentStatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  listDeploymentsFn,
  listRollbackCandidatesFn,
  rollbackDeploymentFn,
} from "@/web/functions/deployments.functions";

const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;

export const Route = createFileRoute("/_app/projects/$projectId/deployments/")({
  head: () => ({ meta: [{ title: "Deploys · Nelcota Deploy" }] }),
  component: ProjectDeploymentsPage,
});

function RollbackButton({ deployment }: { readonly deployment: Deployment }) {
  const rollback = useAction({
    action: () =>
      rollbackDeploymentFn({
        data: { projectId: deployment.projectId, deploymentId: deployment.id },
      }),
    successMessage: "Rollback colocado na fila",
    invalidate: [
      ["deployments", deployment.projectId],
      ["project", deployment.projectId],
    ],
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={rollback.isPending}>
          <RotateCcwIcon aria-hidden />
          Rollback
        </Button>
      }
      title="Voltar para este deploy?"
      description={
        <p>
          Um novo contêiner será criado a partir da imagem{" "}
          <span className="font-mono">{deployment.imageTag ?? "—"}</span>, com as variáveis e
          domínios atuais. O contêiner atual só é removido depois que o novo passar na verificação
          de saúde.
        </p>
      }
      confirmLabel="Fazer rollback"
      onConfirm={() => rollback.mutate()}
    />
  );
}

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
      icon={RocketIcon}
      title="Deploys"
      description="Histórico de builds e publicações. Abra um deploy para ver as etapas e os logs."
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

  const now = new Date();
  return (
    <section aria-label="Histórico de deploys" className="space-y-6">
      {header}
      <List>
        {rows.length === 0 ? (
          <ListRow>
            <p className="text-sm text-muted-foreground">
              {statusFilter === ALL_STATUSES
                ? "Nenhum deploy ainda. Use o botão Deploy acima para publicar a primeira versão."
                : "Nenhum deploy com este status."}
            </p>
          </ListRow>
        ) : null}
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
                <div className="hidden w-36 shrink-0 text-xs text-muted-foreground md:block">
                  <p className="truncate text-muted-foreground">
                    {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}
                  </p>
                  <p className="truncate">{deployment.triggeredByLabel}</p>
                </div>
                <div className="hidden w-24 shrink-0 text-right text-xs sm:block">
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
                <div className="flex shrink-0 justify-end sm:w-32">
                  <DeploymentStatusBadge status={deployment.status} />
                </div>
                {showRollbackColumn ? (
                  <div className="flex shrink-0 justify-end sm:w-28">
                    {isRollbackTarget(deployment.id) ? (
                      <RollbackButton deployment={deployment} />
                    ) : null}
                  </div>
                ) : null}
              </DeploymentListRow>
            ))}
          </Fragment>
        ))}
      </List>
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
          className="font-mono text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {sha == null
            ? `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`
            : sha.slice(0, SHORT_SHA_LENGTH)}
        </Link>
        <span
          className="min-w-0 truncate font-mono text-xs text-muted-foreground"
          title={deployment.branch}
        >
          {deployment.branch}
        </span>
        {current ? <LiveBadge /> : null}
      </div>
      <p
        className="truncate text-sm text-muted-foreground"
        title={deployment.commitMessage ?? undefined}
      >
        {deployment.commitMessage ?? "sem mensagem"}
      </p>
    </div>
  );
}
