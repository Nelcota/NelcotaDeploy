import { createFileRoute } from "@tanstack/react-router";

import { DatabasesPage } from "@/web/components/databases/databases-page";

export const Route = createFileRoute("/_app/projects/$projectId/databases/")({
  head: () => ({ meta: [{ title: "Bancos de dados · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId } = Route.useParams();
  return <DatabasesPage projectId={projectId} />;
}
