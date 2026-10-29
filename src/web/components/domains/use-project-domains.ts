import { useQuery } from "@tanstack/react-query";

import { useApplyChanges } from "@/web/components/deployments/apply-changes-banner";
import { useAction } from "@/web/components/layout/use-action";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { removeDomainFn } from "@/web/functions/domains.functions";

/** A project's domains, their removal, and the redeploy that applies routing changes. */
export function useProjectDomains(projectId: string) {
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const remove = useAction({
    action: (domainId: string) => removeDomainFn({ data: { projectId, domainId } }),
    successMessage: "Domínio removido",
    invalidate: [
      ["project", projectId],
      ["domains-dns", projectId],
    ],
  });
  const details = project.data;
  // Projects that apply changes on their own queue the redeploy when the change is saved.
  const canRedeploy =
    details?.project.currentDeploymentId != null &&
    details.project.autoApplyChanges === false &&
    can("deployment:create");
  // Routing only changes when the container is recreated; the server tracks what is pending.
  const applyChanges = useApplyChanges(
    projectId,
    details?.pendingRuntimeChanges === true,
    canRedeploy,
  );
  return { project, canEdit: can("domain:write"), remove, applyChanges };
}
