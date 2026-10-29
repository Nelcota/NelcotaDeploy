import { useNavigate } from "@tanstack/react-router";

import { useAction } from "@/web/components/layout/use-action";
import {
  containerActionFn,
  deployProjectFn,
  redeployProjectFn,
} from "@/web/functions/deployments.functions";

/** Action the worker can run on a project's live container. */
export type ContainerAction = "start" | "stop" | "restart";

/**
 * Deploy, redeploy and container actions of one project, each with feedback toasts. A new
 * deployment opens its page once queued.
 *
 * @param projectId - Project the actions apply to.
 * @returns The three actions and whether any of them is running.
 */
export function useProjectActions(projectId: string) {
  const navigate = useNavigate();
  const invalidate = [["project", projectId], ["deployments"], ["projects"]] as const;
  const openDeployment = async (result: { deploymentId: string }) => {
    await navigate({
      to: "/projects/$projectId/deployments/$deploymentId",
      params: { projectId, deploymentId: result.deploymentId },
    });
  };

  const deploy = useAction({
    action: () => deployProjectFn({ data: { projectId } }),
    successMessage: (result) =>
      result.created ? "Deploy colocado na fila" : "Já existe um deploy igual na fila",
    invalidate,
    onSuccess: openDeployment,
  });
  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate,
    onSuccess: openDeployment,
  });
  const containerAction = useAction({
    action: (action: ContainerAction) => containerActionFn({ data: { projectId, action } }),
    successMessage: "Ação enviada ao worker",
    invalidate,
  });
  const busy = deploy.isPending || redeploy.isPending || containerAction.isPending;
  return { deploy, redeploy, containerAction, busy };
}
