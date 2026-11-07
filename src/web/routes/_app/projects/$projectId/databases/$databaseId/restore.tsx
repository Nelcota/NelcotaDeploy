import { createFileRoute } from "@tanstack/react-router";

import { DatabaseBackupsPage } from "@/web/components/databases/backups/database-backups-page";

export const Route = createFileRoute("/_app/projects/$projectId/databases/$databaseId/restore")({
  head: () => ({ meta: [{ title: "Restaurar banco · Nelcota Deploy" }] }),
  component: RestoreRoute,
});

function RestoreRoute() {
  const { projectId, databaseId } = Route.useParams();
  return <DatabaseBackupsPage projectId={projectId} databaseId={databaseId} mode="restore" />;
}
