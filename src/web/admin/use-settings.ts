import { useQuery } from "@tanstack/react-query";

import { getSettingsFn } from "@/web/functions/admin/settings.functions";

const SERVER_REFRESH_INTERVAL_IN_MS = 15_000;

/** Settings and server state shared by the organization and server sections. */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettingsFn(),
    refetchInterval: SERVER_REFRESH_INTERVAL_IN_MS,
  });
}
