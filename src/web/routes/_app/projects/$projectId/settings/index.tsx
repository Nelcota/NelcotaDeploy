import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectSettingsOverview } from "@/web/components/project-settings/navigation/project-settings-overview";
import {
  SETTINGS_HEADING_ID,
  legacySettingsDestination,
} from "@/web/components/project-settings/navigation/settings-destinations";

export const Route = createFileRoute("/_app/projects/$projectId/settings/")({
  beforeLoad: ({ params, location }) => {
    const destination = legacySettingsDestination(location.hash);
    if (destination !== "/projects/$projectId/settings") {
      throw redirect({ to: destination, params, hash: SETTINGS_HEADING_ID, replace: true });
    }
  },
  component: ProjectSettingsIndex,
});

function ProjectSettingsIndex() {
  const { projectId } = Route.useParams();
  return <ProjectSettingsOverview projectId={projectId} />;
}
