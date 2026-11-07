import { Link } from "@tanstack/react-router";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { Button } from "@/web/components/ui/button";

import { DeploymentLogs } from "./deployment-detail-parts";
import { useDeploymentDetail } from "./use-deployment-detail";

/** Reads build output independently from deployment configuration and progress cards. */
export function DeploymentLogsPage({
  projectId,
  deploymentId,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
}) {
  const { deployment, active, onLogEnd } = useDeploymentDetail(projectId, deploymentId);
  if (deployment.isError) {
    return <ErrorState error={deployment.error} onRetry={() => void deployment.refetch()} />;
  }
  if (deployment.data == null) {
    return <ListSkeleton rows={2} />;
  }
  if (deployment.data.projectId !== projectId) {
    return <p role="alert">Deploy não encontrado neste projeto.</p>;
  }
  return (
    <>
      <TabHeader
        title="Logs da construção da imagem"
        actions={
          <Button variant="outline" asChild>
            <Link
              to="/projects/$projectId/deployments/$deploymentId"
              params={{ projectId, deploymentId }}
            >
              Ver progresso do deploy
            </Link>
          </Button>
        }
      />
      <DeploymentLogs deployment={deployment.data} active={active} onEnd={onLogEnd} />
    </>
  );
}
