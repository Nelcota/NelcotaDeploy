import { createFileRoute } from "@tanstack/react-router";

import { ProjectSettingsPage } from "@/web/components/project-settings/project-settings-page";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  head: () => ({ meta: [{ title: "Ajustes · Nelcota Deploy" }] }),
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectSettingsPage projectId={projectId} />;
}
