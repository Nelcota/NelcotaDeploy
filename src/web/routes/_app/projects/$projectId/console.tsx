import { createFileRoute } from "@tanstack/react-router";

import { ConsolePage } from "@/web/components/console/console-page";

export const Route = createFileRoute("/_app/projects/$projectId/console")({
  head: () => ({ meta: [{ title: "Console · Nelcota Deploy" }] }),
  component: ConsoleRoute,
});

function ConsoleRoute() {
  const { projectId } = Route.useParams();
  return <ConsolePage projectId={projectId} />;
}
