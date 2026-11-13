import { createFileRoute } from "@tanstack/react-router";

import { DeploymentLogsPage } from "@/web/components/deployment-detail/deployment-logs-page";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/$deploymentId/logs")({
  head: () => ({ meta: [{ title: "Logs do deploy · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId, deploymentId } = Route.useParams();
  return <DeploymentLogsPage projectId={projectId} deploymentId={deploymentId} />;
}
