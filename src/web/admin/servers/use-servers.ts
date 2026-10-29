import { useQuery } from "@tanstack/react-query";

import { listServersFn } from "@/web/functions/admin/servers.functions";

import { hasServerInProgress } from "./server-status";

// The worker checks servers every ten seconds; a server being set up shows up quickly.
const SETUP_REFRESH_INTERVAL_IN_MS = 5000;
const REFRESH_INTERVAL_IN_MS = 15_000;

export type ServerView = Awaited<ReturnType<typeof listServersFn>>["servers"][number];

/** Servers with their latest usage, refreshed faster while one is being set up. */
export function useServers() {
  return useQuery({
    queryKey: ["servers"],
    queryFn: () => listServersFn(),
    refetchInterval: (query) =>
      hasServerInProgress(query.state.data?.servers ?? [])
        ? SETUP_REFRESH_INTERVAL_IN_MS
        : REFRESH_INTERVAL_IN_MS,
  });
}
