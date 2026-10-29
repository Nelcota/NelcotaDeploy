import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { projectQueryOptions } from "@/web/components/projects/project-query";
import { getDeploymentFn } from "@/web/functions/deployments.functions";

import { finalStatusOf, isActiveDeployment } from "./deployment-detail";

const ACTIVE_REFRESH_INTERVAL_IN_MS = 2000;
const CLOCK_TICK_IN_MS = 1000;

/** Current time that updates every second while enabled, for live durations. */
function useLiveClock(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (enabled === false) {
      return undefined;
    }
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_IN_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * Builds the handler for the end of the log stream: announces results the user watched happen
 * (not finished deploys opened later) and refreshes everything the deploy changed.
 */
function useLogEndHandler({
  projectId,
  deploymentId,
  active,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly active: boolean;
}) {
  const queryClient = useQueryClient();
  const watchedLive = useRef(false);
  useEffect(() => {
    if (active) {
      watchedLive.current = true;
    }
  }, [active]);
  return (summary: unknown) => {
    const status = finalStatusOf(summary);
    if (watchedLive.current && status === "succeeded") {
      toast.success("Deploy concluído");
    }
    if (watchedLive.current && status === "failed") {
      toast.error("O deploy falhou. Veja os logs para o motivo.");
    }
    void queryClient.invalidateQueries({ queryKey: ["deployment", deploymentId] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["deployments", projectId] });
  };
}

/** One deploy, refreshed while it runs, with its project, a live clock and the log end handler. */
export function useDeploymentDetail(projectId: string, deploymentId: string) {
  const project = useQuery(projectQueryOptions(projectId));
  const deployment = useQuery({
    queryKey: ["deployment", deploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId } }),
    refetchInterval: (query) =>
      isActiveDeployment(query.state.data?.status) ? ACTIVE_REFRESH_INTERVAL_IN_MS : false,
  });
  const active = isActiveDeployment(deployment.data?.status);
  const now = useLiveClock(active);
  const onLogEnd = useLogEndHandler({ projectId, deploymentId, active });
  return { project, deployment, active, now, onLogEnd };
}

export type DeploymentDetailData = NonNullable<
  ReturnType<typeof useDeploymentDetail>["deployment"]["data"]
>;
