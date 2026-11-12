import { createFileRoute, redirect } from "@tanstack/react-router";

import {
  ProjectSettingsNavigation,
  legacySettingsDestination,
} from "@/web/components/project-settings/project-settings-navigation";
import { TabHeader } from "@/web/components/projects/project-header";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/projects/$projectId/settings/")({
  beforeLoad: ({ params, location }) => {
    const destination = legacySettingsDestination(location.hash);
    if (destination !== "/projects/$projectId/settings") {
      throw redirect({ to: destination, params, replace: true });
    }
  },
  component: ProjectSettingsIndex,
});

function ProjectSettingsIndex() {
  const { projectId } = Route.useParams();
  const can = useCan();
  return (
    <div className="space-y-4">
      <TabHeader title="Configurações do projeto" />
      <ProjectSettingsNavigation projectId={projectId} can={can} overview />
    </div>
  );
}
