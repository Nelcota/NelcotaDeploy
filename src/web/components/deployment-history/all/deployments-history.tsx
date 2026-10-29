import { useState } from "react";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { ALL_STATUSES, type StatusFilter } from "../deployment-history";
import { DeploymentHistoryList, LoadMoreButton } from "../deployment-history-list";
import { type DeploymentHistory, useDeploymentHistory } from "../use-deployment-history";
import { ALL_PROJECTS, EmptyHistory, HistoryHeader } from "./history-filters";
import { HistoryRow } from "./history-row";

/** Every deploy, newest first, split by day, filtered by status and project. */
export function DeploymentsHistory() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const status = statusFilter === ALL_STATUSES ? undefined : statusFilter;
  const projectId = projectFilter === ALL_PROJECTS ? undefined : projectFilter;
  const history = useDeploymentHistory({
    queryKey: ["deployments", "all", statusFilter, projectFilter],
    filters: {
      ...(status == null ? {} : { status }),
      ...(projectId == null ? {} : { projectId }),
    },
  });
  const clearFilters = () => {
    setStatusFilter(ALL_STATUSES);
    setProjectFilter(ALL_PROJECTS);
  };

  return (
    <section aria-labelledby="history-title" className="space-y-6">
      <HistoryHeader
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />
      <HistoryContent
        history={history}
        filtered={status != null || projectId != null}
        onClearFilters={clearFilters}
      />
      <LoadMoreButton deployments={history.deployments} />
    </section>
  );
}

function HistoryContent({
  history,
  filtered,
  onClearFilters,
}: {
  readonly history: DeploymentHistory;
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
}) {
  const { deployments, rows, groups } = history;
  if (deployments.isError) {
    return <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  }
  if (deployments.isPending) {
    return <ListSkeleton rows={6} />;
  }
  if (rows.length === 0) {
    return <EmptyHistory filtered={filtered} onClearFilters={onClearFilters} />;
  }
  return (
    <DeploymentHistoryList
      groups={groups}
      renderRow={(deployment) => <HistoryRow key={deployment.id} deployment={deployment} />}
    />
  );
}
