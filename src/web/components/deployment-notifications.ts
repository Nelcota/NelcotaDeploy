import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { listDeploymentsFn } from "@/web/functions/deployments.functions";

import { ACTIVE_DEPLOYMENT_STATUSES } from "./labels";

const POLL_INTERVAL_IN_MS = 5000;
const WATCHED_DEPLOYMENTS = 10;

/**
 * Shows a toast on any page when a deployment that was running finishes, so nobody has to
 * keep the deployment page open. The deployment page itself already announces its result.
 */
export function useDeploymentNotifications(): void {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const viewingId = typeof params.deploymentId === "string" ? params.deploymentId : null;
  const deployments = useQuery({
    queryKey: ["deployments", "notifications"],
    queryFn: () => listDeploymentsFn({ data: { limit: WATCHED_DEPLOYMENTS } }),
    refetchInterval: POLL_INTERVAL_IN_MS,
  });
  const previousStatuses = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (deployments.data == null) {
      return;
    }
    const previous = previousStatuses.current;
    previousStatuses.current = new Map(
      deployments.data.map((deployment) => [deployment.id, deployment.status]),
    );
    // The first load is history, not news.
    if (previous == null) {
      return;
    }
    for (const deployment of deployments.data) {
      const before = previous.get(deployment.id);
      const justFinished =
        before != null &&
        ACTIVE_DEPLOYMENT_STATUSES.has(before) &&
        ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status) === false;
      if (
        justFinished === false ||
        deployment.id === viewingId ||
        deployment.status === "cancelled"
      ) {
        continue;
      }
      const open = {
        label: "Ver deploy",
        onClick: () =>
          void navigate({
            to: "/projects/$projectId/deployments/$deploymentId",
            params: { projectId: deployment.projectId, deploymentId: deployment.id },
          }),
      };
      if (deployment.status === "succeeded") {
        toast.success(`Deploy de ${deployment.projectName} concluído`, { action: open });
      } else {
        toast.error(`Deploy de ${deployment.projectName} falhou`, { action: open });
      }
    }
  }, [deployments.data, navigate, viewingId]);
}
