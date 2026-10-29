import { createFileRoute } from "@tanstack/react-router";

import { DeploymentDetailPage } from "@/web/components/deployment-detail/deployment-detail-page";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId")({
  head: () => ({ meta: [{ title: "Deploy · Nelcota Deploy" }] }),
  component: DeploymentDetailRoute,
});

function DeploymentDetailRoute() {
  const { projectId, deploymentId } = Route.useParams();
  return <DeploymentDetailPage projectId={projectId} deploymentId={deploymentId} />;
}
