import { queryOptions } from "@tanstack/react-query";

import { getProjectFn } from "@/web/functions/project-detail.functions";

const PROJECT_REFRESH_INTERVAL_IN_MS = 5000;

/**
 * Query for a project with its domains, containers and worker status. The project layout
 * and every tab share this cache entry.
 */
export function projectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { projectId } }),
    refetchInterval: PROJECT_REFRESH_INTERVAL_IN_MS,
  });
}

export type ProjectDetails = Awaited<ReturnType<typeof getProjectFn>>;
