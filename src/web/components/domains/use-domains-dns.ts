import { useQuery } from "@tanstack/react-query";

import { getDomainsDnsFn } from "@/web/functions/servers/server-address.functions";

import type { DomainDns } from "./domains";

// DNS changes take minutes to spread; checking once a minute shows them soon enough.
const DNS_REFRESH_INTERVAL_IN_MS = 60_000;

/** Where each domain of a project points, checked again every minute. */
export function useDomainsDns(projectId: string): ReadonlyMap<string, DomainDns> {
  const query = useQuery({
    queryKey: ["domains-dns", projectId],
    queryFn: () => getDomainsDnsFn({ data: { projectId } }),
    refetchInterval: DNS_REFRESH_INTERVAL_IN_MS,
  });
  return new Map((query.data ?? []).map((entry) => [entry.hostname, entry]));
}
