import { createFileRoute } from "@tanstack/react-router";

import { ProjectOverview } from "@/web/components/project-overview/project-overview";

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewPage,
});

function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  return <ProjectOverview projectId={projectId} />;
}
