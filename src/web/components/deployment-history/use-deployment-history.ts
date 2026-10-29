import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { DeploymentStatus } from "@/deployments";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

import {
  groupByDay,
  historyRefreshInterval,
  nextPageCursor,
  PAGE_SIZE,
} from "./deployment-history";

/**
 * Pages through deploys newest first, optionally of one project or status, and groups them by day.
 *
 * @param queryKey - Cache key; keep `["deployments", ...]` so invalidations elsewhere reach it.
 * @param filters - Optional project and status to narrow the list.
 */
export function useDeploymentHistory({
  queryKey,
  filters,
}: {
  readonly queryKey: readonly unknown[];
  readonly filters: { readonly projectId?: string; readonly status?: DeploymentStatus };
}) {
  const deployments = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      listDeploymentsFn({
        data: {
          limit: PAGE_SIZE,
          ...(filters.status == null ? {} : { status: filters.status }),
          ...(filters.projectId == null ? {} : { projectId: filters.projectId }),
          ...(pageParam == null ? {} : { before: pageParam }),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => nextPageCursor(lastPage),
    refetchInterval: (query) => historyRefreshInterval(query.state.data?.pages.flat() ?? []),
  });
  const rows = useMemo(() => deployments.data?.pages.flat() ?? [], [deployments.data]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  return { deployments, rows, groups };
}

export type DeploymentHistory = ReturnType<typeof useDeploymentHistory>;
export type DeploymentItem = DeploymentHistory["rows"][number];
