import { createFileRoute, Outlet } from "@tanstack/react-router";

import { ProjectSettingsNavigation } from "@/web/components/project-settings/project-settings-navigation";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  head: () => ({ meta: [{ title: "Configurações do projeto · Nelcota Deploy" }] }),
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  const { projectId } = Route.useParams();
  const can = useCan();
  return (
    <>
      <ProjectSettingsNavigation projectId={projectId} can={can} />
      <Outlet />
    </>
  );
}
