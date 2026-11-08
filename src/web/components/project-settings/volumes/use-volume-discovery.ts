import { useQuery } from "@tanstack/react-query";

import { useServers } from "@/web/admin";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { getRepositoryVolumesFn } from "@/web/functions/repository/automation.functions";

const DISCOVERY_STALE_TIME_IN_MS = 300_000;

export function useVolumeDiscovery(projectId: string) {
  const project = useQuery(projectQueryOptions(projectId));
  const servers = useServers();
  const discovery = useQuery({
    queryKey: [
      "repository-volumes",
      projectId,
      project.data?.project.repositoryUrl,
      project.data?.project.branch,
      project.data?.project.dockerfilePath,
    ],
    queryFn: () => getRepositoryVolumesFn({ data: { projectId } }),
    enabled: project.data != null,
    staleTime: DISCOVERY_STALE_TIME_IN_MS,
    retry: false,
  });
  return {
    project,
    servers,
    server: servers.data?.servers.find((server) => server.id === project.data?.project.serverId),
    discovery,
  };
}
