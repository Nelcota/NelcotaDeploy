import { useQuery } from "@tanstack/react-query";

import { getDashboardFn, getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";

const STATUS_POLL_INTERVAL_IN_MS = 10_000;

/** Worker and Docker health plus running deployments, shared by the sidebar and the top bar. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
}

/** Every project, refreshed with the system status, for the sidebar list and counts. */
export function useProjectList() {
  return useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
}

/** Online and offline project counts for the top bar shortcuts. */
export function useDashboardCounts() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
}
