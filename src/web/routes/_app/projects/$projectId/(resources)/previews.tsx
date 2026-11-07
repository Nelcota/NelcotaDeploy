import { createFileRoute } from "@tanstack/react-router";

import { ProjectPreviewsPage } from "@/web/components/project-overview/previews-card";

export const Route = createFileRoute("/_app/projects/$projectId/(resources)/previews")({
  head: () => ({ meta: [{ title: "Ambientes de teste por pull request · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId } = Route.useParams();
  return <ProjectPreviewsPage projectId={projectId} />;
}
