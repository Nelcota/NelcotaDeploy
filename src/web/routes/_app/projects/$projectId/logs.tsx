import { createFileRoute } from "@tanstack/react-router";

import { RuntimeLogsPage } from "@/web/components/runtime-logs/runtime-logs-page";

export const Route = createFileRoute("/_app/projects/$projectId/logs")({
  head: () => ({ meta: [{ title: "Logs · Nelcota Deploy" }] }),
  component: RuntimeLogsRoute,
});

function RuntimeLogsRoute() {
  const { projectId } = Route.useParams();
  return <RuntimeLogsPage projectId={projectId} />;
}
