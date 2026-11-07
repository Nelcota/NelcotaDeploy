import { createFileRoute } from "@tanstack/react-router";

import { ProjectMetricsPage } from "@/web/components/project-metrics/project-metrics-page";

export const Route = createFileRoute("/_app/projects/$projectId/metrics")({
  head: () => ({ meta: [{ title: "Uso de recursos da aplicação · Nelcota Deploy" }] }),
  component: ProjectMetricsRoute,
});

function ProjectMetricsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectMetricsPage projectId={projectId} />;
}
