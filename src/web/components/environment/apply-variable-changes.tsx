import { useQuery } from "@tanstack/react-query";

import {
  ApplyChangesBanner,
  useApplyChanges,
} from "@/web/components/deployments/apply-changes-banner";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";

/** Offers a redeploy when saved variables have not reached the running container yet. */
export function ApplyVariableChanges({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const canRedeploy = project.data?.project.currentDeploymentId != null && can("deployment:create");
  const { redeploy, showBanner } = useApplyChanges(
    projectId,
    project.data?.pendingRuntimeChanges === true,
    canRedeploy,
  );
  if (showBanner === false) {
    return null;
  }
  return (
    <ApplyChangesBanner
      message="As variáveis mudaram. Elas chegam à aplicação quando o contêiner é recriado."
      applying={redeploy.isPending}
      onApply={() => redeploy.mutate()}
    />
  );
}
