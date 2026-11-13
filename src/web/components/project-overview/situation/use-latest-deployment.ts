import { useQuery } from "@tanstack/react-query";

import { ACTIVE_DEPLOYMENT_STATUSES } from "@/web/components/layout/labels";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const LATEST_DEPLOYMENT_LIMIT = 1;
const ACTIVE_POLL_INTERVAL_IN_MS = 5000;
const IDLE_POLL_INTERVAL_IN_MS = 30_000;

export type LatestDeployment = Awaited<ReturnType<typeof listDeploymentsFn>>[number];

/** Loads the newest deployment in the project's own environment. */
export function useLatestDeployment(projectId: string) {
  return useQuery({
    queryKey: ["deployments", projectId, "latest"],
    queryFn: () => listDeploymentsFn({ data: { projectId, limit: LATEST_DEPLOYMENT_LIMIT } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((deployment) =>
        ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status),
      )
        ? ACTIVE_POLL_INTERVAL_IN_MS
        : IDLE_POLL_INTERVAL_IN_MS,
  });
}
