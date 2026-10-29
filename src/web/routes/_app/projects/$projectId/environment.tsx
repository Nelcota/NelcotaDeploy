import { createFileRoute } from "@tanstack/react-router";

import { EnvironmentPage } from "@/web/components/environment/environment-page";

export const Route = createFileRoute("/_app/projects/$projectId/environment")({
  head: () => ({ meta: [{ title: "Variáveis · Nelcota Deploy" }] }),
  component: EnvironmentRoute,
});

function EnvironmentRoute() {
  const { projectId } = Route.useParams();
  return <EnvironmentPage projectId={projectId} />;
}
