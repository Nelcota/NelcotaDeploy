import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";

import { findFinishedDeployments } from "@/web/components/shell/notifications/finished-deployments";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const POLL_INTERVAL_IN_MS = 5000;
const WATCHED_DEPLOYMENTS = 10;

type FinishedDeployment = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: string;
};

function notifyFinished(
  deployment: FinishedDeployment,
  navigate: ReturnType<typeof useNavigate>,
): void {
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
    return;
  }
  toast.error(`Deploy de ${deployment.projectName} falhou`, { action: open });
}

/**
 * Shows a toast on any page when a deployment that was running finishes, so nobody has to
 * keep the deployment page open. The deployment page itself already announces its result.
 */
export function useDeploymentNotifications(): void {
  const navigate = useNavigate();
  // An effect event: the polling effect must not re-run when navigate changes identity.
  const notify = useEffectEvent((deployment: FinishedDeployment) =>
    notifyFinished(deployment, navigate),
  );
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
    for (const deployment of findFinishedDeployments(previous, deployments.data, viewingId)) {
      notify(deployment);
    }
  }, [deployments.data, viewingId]);
}
