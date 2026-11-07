import { createFileRoute } from "@tanstack/react-router";

import { DeploymentDetailPage } from "@/web/components/deployment-detail/deployment-detail-page";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId/")({
  head: () => ({ meta: [{ title: "Progresso do deploy · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId, deploymentId } = Route.useParams();
  return <DeploymentDetailPage projectId={projectId} deploymentId={deploymentId} />;
}
