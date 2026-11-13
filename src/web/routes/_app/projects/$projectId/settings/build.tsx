import { createFileRoute } from "@tanstack/react-router";

import { ProjectSettingsPage } from "@/web/components/project-settings/project-settings-page";

export const Route = createFileRoute("/_app/projects/$projectId/settings/build")({
  head: () => ({ meta: [{ title: "Build e Dockerfile · Nelcota Deploy" }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectSettingsPage projectId={projectId} section="build" />;
}
