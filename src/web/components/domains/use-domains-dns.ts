import { useQuery } from "@tanstack/react-query";

import { getDomainsDnsFn } from "@/web/functions/servers/server-address.functions";

// DNS changes take minutes to spread; checking once a minute shows them soon enough.
const DNS_REFRESH_INTERVAL_IN_MS = 60_000;
const DNS_PROPAGATION_REFRESH_INTERVAL_IN_MS = 15_000;

/** Where each domain of a project points, checked again every minute. */
export function useDomainsDns(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["domains-dns", projectId],
    queryFn: () => getDomainsDnsFn({ data: { projectId } }),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some(
        (entry) => entry.status === "missing" || entry.status === "elsewhere",
      ) === true
        ? DNS_PROPAGATION_REFRESH_INTERVAL_IN_MS
        : DNS_REFRESH_INTERVAL_IN_MS,
  });
}
