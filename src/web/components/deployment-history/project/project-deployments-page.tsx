import { useState } from "react";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { ALL_STATUSES, rollbackColumnState, type StatusFilter } from "../deployment-history";
import { DeploymentHistoryList, LoadMoreButton } from "../deployment-history-list";
import { type DeploymentHistory, useDeploymentHistory } from "../use-deployment-history";
import { ProjectDeploymentRow } from "./project-deployment-row";
import { EmptyHistory, ProjectHistoryHeader } from "./project-history-states";
import { useRollbackTargets } from "./use-rollback-targets";

/** Build and publish history of one project, filtered by status, with rollback buttons. */
export function ProjectDeploymentsPage({ projectId }: { readonly projectId: string }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const history = useDeploymentHistory({
    // The prefix stays ["deployments", projectId] so invalidations elsewhere still reach it.
    queryKey: ["deployments", projectId, statusFilter],
    filters: { projectId, ...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter }) },
  });
  return (
    <section aria-label="Histórico de deploys" className="space-y-6">
      <ProjectHistoryHeader statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} />
      <ProjectHistoryContent
        projectId={projectId}
        history={history}
        filtered={statusFilter !== ALL_STATUSES}
        onClearFilter={() => setStatusFilter(ALL_STATUSES)}
      />
    </section>
  );
}

function ProjectHistoryContent({
  projectId,
  history,
  filtered,
  onClearFilter,
}: {
  readonly projectId: string;
  readonly history: DeploymentHistory;
  readonly filtered: boolean;
  readonly onClearFilter: () => void;
}) {
  const { deployments, rows, groups } = history;
  const { currentDeploymentId, isRollbackTarget } = useRollbackTargets(projectId);
  if (deployments.isError) {
    return <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  }
  if (deployments.isPending) {
    return <ListSkeleton rows={6} />;
  }
  if (rows.length === 0) {
    return <EmptyHistory filtered={filtered} onClearFilter={onClearFilter} />;
  }
  // The rollback column only takes space when at least one listed deploy can be restored.
  const showRollbackColumn = rows.some((row) => isRollbackTarget(row.id));
  return (
    <>
      <DeploymentHistoryList
        groups={groups}
        renderRow={(deployment) => (
          <ProjectDeploymentRow
            key={deployment.id}
            deployment={deployment}
            current={deployment.id === currentDeploymentId}
            rollback={rollbackColumnState(showRollbackColumn, isRollbackTarget(deployment.id))}
          />
        )}
      />
      <LoadMoreButton deployments={deployments} />
    </>
  );
}
