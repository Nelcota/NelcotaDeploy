import { useQuery } from "@tanstack/react-query";

import { useAction } from "@/web/components/layout/use-action";
import { useCan } from "@/web/components/shell/use-permissions";
import {
  backupDatabaseFn,
  listDatabaseBackupsFn,
  restoreDatabaseBackupFn,
} from "@/web/functions/databases/databases.functions";

// While a backup runs the list refreshes, so its row follows on its own.
const PENDING_REFRESH_IN_MS = 3000;

/** The backups of one database and the actions on them; loads only while `open`. */
export function useDatabaseBackups(target: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly open: boolean;
}) {
  const { projectId, databaseId, open } = target;
  const can = useCan();
  const backups = useQuery({
    queryKey: ["database-backups", databaseId],
    queryFn: () => listDatabaseBackupsFn({ data: { projectId, databaseId } }),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.some(
        (backup) => backup.status === "queued" || backup.status === "running",
      ) === true
        ? PENDING_REFRESH_IN_MS
        : false,
  });
  const invalidate = [
    ["database-backups", databaseId],
    ["databases", projectId],
  ] as const;
  const backupNow = useAction({
    action: () => backupDatabaseFn({ data: { projectId, databaseId } }),
    successMessage: "Backup colocado na fila",
    invalidate,
  });
  const restore = useAction({
    action: (backupId: string) =>
      restoreDatabaseBackupFn({ data: { projectId, databaseId, backupId } }),
    successMessage: "Restauração colocada na fila",
    invalidate,
  });
  return {
    backups,
    backupNow,
    restore,
    canBackup: can("project:write"),
    canRestore: can("project:delete"),
  };
}
