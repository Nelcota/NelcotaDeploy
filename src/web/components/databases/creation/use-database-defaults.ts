import { useQuery } from "@tanstack/react-query";

import { useServers } from "@/web/admin";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { listEnvironmentVariablesFn } from "@/web/functions/environment.functions";
import { getEnvironmentExampleFn } from "@/web/functions/repository/environment-example.functions";

const TEMPLATE_STALE_TIME_IN_MS = 300_000;

/** Reads configuration only; provisioning is still an explicit, reviewed action. */
export function useDatabaseDefaults(projectId: string) {
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const servers = useServers();
  const variables = useQuery({
    queryKey: ["environment", projectId],
    queryFn: () => listEnvironmentVariablesFn({ data: { projectId } }),
  });
  const template = useQuery({
    queryKey: [
      "environment-example",
      projectId,
      project.data?.project.repositoryUrl,
      project.data?.project.branch,
      project.data?.project.buildContext,
      project.data?.project.dockerfilePath,
      undefined,
    ],
    queryFn: () => getEnvironmentExampleFn({ data: { projectId } }),
    enabled: project.data != null && can("environment:write"),
    staleTime: TEMPLATE_STALE_TIME_IN_MS,
    retry: false,
  });
  const server = servers.data?.servers.find(
    (candidate) => candidate.id === project.data?.project.serverId,
  );
  return {
    variables,
    template,
    templateKeys: template.isError ? [] : (template.data?.entries.map((entry) => entry.key) ?? []),
    project,
    servers,
    server,
  };
}
