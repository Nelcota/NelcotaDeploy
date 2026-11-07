import { createFileRoute, redirect } from "@tanstack/react-router";

import { legacySettingsDestination } from "@/web/components/project-settings/project-settings-navigation";

export const Route = createFileRoute("/_app/projects/$projectId/settings/")({
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: legacySettingsDestination(location.hash), params, replace: true });
  },
});
