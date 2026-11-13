import { useQuery } from "@tanstack/react-query";

import { useNow } from "@/web/components/clock/use-now";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { getDomainUptimeFn } from "@/web/functions/domains.functions";

import { domainAccess } from "./domain-access";
import type { DomainUptime } from "./uptime-state";

// The worker checks every domain once a minute.
const UPTIME_REFRESH_INTERVAL_IN_MS = 60_000;
const DOMAIN_PROGRESS_REFRESH_INTERVAL_IN_MS = 10_000;

/** Availability of each domain of a project, refreshed as often as the worker checks. */
export function useDomainUptime(
  projectId: string,
  {
    enabled = true,
    releaseId = null,
    trackProgress = false,
  }: {
    readonly enabled?: boolean;
    readonly releaseId?: string | null;
    readonly trackProgress?: boolean;
  } = {},
) {
  const query = useQuery({
    queryKey: ["domain-uptime", projectId, releaseId],
    queryFn: () => getDomainUptimeFn({ data: { projectId } }),
    enabled,
    refetchInterval: (query) => {
      if (trackProgress === false) {
        return UPTIME_REFRESH_INTERVAL_IN_MS;
      }

      const checks = query.state.data ?? [];
      const waiting =
        checks.length === 0 ||
        checks.some((entry) => entry.status !== "private" && entry.recent.at(-1)?.up !== true);
      return waiting ? DOMAIN_PROGRESS_REFRESH_INTERVAL_IN_MS : UPTIME_REFRESH_INTERVAL_IN_MS;
    },
  });
  const byHostname: ReadonlyMap<string, DomainUptime> = new Map(
    (query.data ?? []).map((entry) => [entry.hostname, entry]),
  );
  return {
    byHostname,
    refresh: query.refetch,
    refreshing: query.isFetching,
    loading: query.isLoading,
  };
}

/** Access state of the preferred project domain, refreshed using the existing uptime checks. */
export function useProjectDomainAccess(details: ProjectDetails, enabled = true) {
  const domain = details.domains.at(0);
  const uptime = useDomainUptime(details.project.id, {
    enabled: enabled && domain != null,
    releaseId: details.liveDeployment?.id ?? null,
  });
  const now = useNow();
  const access =
    domain == null
      ? null
      : domainAccess({
          pending: details.pendingRuntimeChanges,
          publishedAt: details.liveDeployment?.finishedAt ?? null,
          uptime: uptime.byHostname.get(domain.hostname),
          now,
        });
  return { domain, access, ...uptime };
}
