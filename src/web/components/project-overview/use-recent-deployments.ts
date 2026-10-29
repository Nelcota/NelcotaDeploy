import { useQuery } from "@tanstack/react-query";

import { ACTIVE_DEPLOYMENT_STATUSES } from "@/web/components/layout/labels";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const RECENT_DEPLOYMENTS = 6;
const ACTIVE_POLL_INTERVAL_IN_MS = 5000;
const IDLE_POLL_INTERVAL_IN_MS = 30_000;

export type RecentDeployment = Awaited<ReturnType<typeof listDeploymentsFn>>[number];

/** Loads the latest deployments, polling faster while one of them is still running. */
export function useRecentDeployments(projectId: string) {
  return useQuery({
    queryKey: ["deployments", { projectId, limit: RECENT_DEPLOYMENTS }],
    queryFn: () => listDeploymentsFn({ data: { projectId, limit: RECENT_DEPLOYMENTS } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((deployment) =>
        ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status),
      )
        ? ACTIVE_POLL_INTERVAL_IN_MS
        : IDLE_POLL_INTERVAL_IN_MS,
  });
}
