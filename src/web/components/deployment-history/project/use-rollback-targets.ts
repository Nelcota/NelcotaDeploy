import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { listRollbackCandidatesFn } from "@/web/functions/deployments.functions";

/**
 * Tells which deploys of a project this user can roll back to, and which one is live.
 *
 * @param projectId - Project whose deploys are listed.
 */
export function useRollbackTargets(projectId: string) {
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const candidates = useQuery({
    queryKey: ["rollback-candidates", projectId],
    queryFn: () => listRollbackCandidatesFn({ data: { projectId } }),
  });
  const rollbackIds = useMemo(
    () => new Set((candidates.data ?? []).map((candidate) => candidate.id)),
    [candidates.data],
  );
  const currentDeploymentId = project.data?.project.currentDeploymentId ?? null;
  const canRollback = can("deployment:create");
  const isRollbackTarget = (deploymentId: string): boolean =>
    canRollback && rollbackIds.has(deploymentId) && deploymentId !== currentDeploymentId;
  return { currentDeploymentId, isRollbackTarget };
}
