import { createFileRoute } from "@tanstack/react-router";

import { DatabaseBackupsPage } from "@/web/components/databases/backups/database-backups-page";

export const Route = createFileRoute("/_app/projects/$projectId/databases/$databaseId/backups")({
  head: () => ({ meta: [{ title: "Backups do banco · Nelcota Deploy" }] }),
  component: PageRoute,
});

function PageRoute() {
  const { projectId, databaseId } = Route.useParams();
  return <DatabaseBackupsPage projectId={projectId} databaseId={databaseId} />;
}
