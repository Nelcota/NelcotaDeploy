import { createFileRoute } from "@tanstack/react-router";

import { ProjectDeploymentsPage } from "@/web/components/deployment-history/project/project-deployments-page";

export const Route = createFileRoute("/_app/projects/$projectId/deployments/")({
  head: () => ({ meta: [{ title: "Histórico de deploys · Nelcota Deploy" }] }),
  component: ProjectDeploymentsRoute,
});

function ProjectDeploymentsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectDeploymentsPage projectId={projectId} />;
}
