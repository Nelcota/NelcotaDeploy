import { useQuery } from "@tanstack/react-query";

import { getDashboardFn } from "@/web/functions/dashboard.functions";

import { REFRESH_INTERVAL_IN_MS } from "./dashboard";

/** Reads the application and deployment summaries without loading host metrics. */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
}
