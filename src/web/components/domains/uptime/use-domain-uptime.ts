import { useQuery } from "@tanstack/react-query";

import { getDomainUptimeFn } from "@/web/functions/domains.functions";

import type { DomainUptime } from "./uptime-state";

// The worker checks every domain once a minute.
const UPTIME_REFRESH_INTERVAL_IN_MS = 60_000;

/** Availability of each domain of a project, refreshed as often as the worker checks. */
export function useDomainUptime(projectId: string): ReadonlyMap<string, DomainUptime> {
  const query = useQuery({
    queryKey: ["domain-uptime", projectId],
    queryFn: () => getDomainUptimeFn({ data: { projectId } }),
    refetchInterval: UPTIME_REFRESH_INTERVAL_IN_MS,
  });
  return new Map((query.data ?? []).map((entry) => [entry.hostname, entry]));
}
