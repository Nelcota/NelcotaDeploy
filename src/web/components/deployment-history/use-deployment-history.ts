import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { DeploymentStatus } from "@/deployments";
import type { PageCursor } from "@/shared/pagination";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

import {
  groupByDay,
  historyRefreshInterval,
  nextPageCursor,
  PAGE_SIZE,
} from "./deployment-history";

const MAX_CURSOR_HISTORY = 100;
const INITIAL_CURSORS: readonly (PageCursor | null)[] = [null];

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
  const key = JSON.stringify(queryKey);
  const [pagination, setPagination] = useState({ key, cursors: INITIAL_CURSORS });
  if (pagination.key !== key) {
    setPagination({ key, cursors: INITIAL_CURSORS });
  }
  const cursors = pagination.key === key ? pagination.cursors : INITIAL_CURSORS;
  const cursor = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: [...queryKey, { before: cursor }],
    queryFn: () =>
      listDeploymentsFn({
        data: {
          limit: PAGE_SIZE,
          ...(filters.status == null ? {} : { status: filters.status }),
          ...(filters.projectId == null ? {} : { projectId: filters.projectId }),
          ...(cursor == null ? {} : { before: cursor }),
        },
      }),
    // Only the visible page is retained or polled; old cursors are small and bounded.
    gcTime: 0,
    placeholderData: (previous, previousQuery) =>
      JSON.stringify(previousQuery?.queryKey.slice(0, -1)) === key ? previous : undefined,
    refetchInterval: (current) => historyRefreshInterval(current.state.data ?? []),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const deployments = {
    ...query,
    hasNextPage: nextPageCursor(rows) != null,
    hasPreviousPage: cursors.length > 1,
    canReset: cursor != null,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => {
      const next = nextPageCursor(rows);
      if (query.isFetching || next == null) {
        return;
      }
      setPagination({ key, cursors: [...cursors, next].slice(-MAX_CURSOR_HISTORY) });
    },
    fetchPreviousPage: () =>
      setPagination({ key, cursors: cursors.length > 1 ? cursors.toSpliced(-1) : cursors }),
    reset: () => setPagination({ key, cursors: INITIAL_CURSORS }),
  };
  return { deployments, rows, groups };
}

export type DeploymentHistory = ReturnType<typeof useDeploymentHistory>;
export type DeploymentItem = DeploymentHistory["rows"][number];
