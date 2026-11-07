/** Fields of a backup that decide what its row shows and allows. */
type BackupFields = {
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly restoredAt: string | null;
  readonly restoreError: string | null;
  readonly restorePending: boolean;
};

/** What a backup row shows: a tag, a note about its last restore and whether it can be restored. */
export type BackupState = {
  readonly label: string;
  readonly tone: "neutral" | "warning" | "success";
  readonly restoreNote: string | null;
  readonly canRestore: boolean;
};

const STATUS_LABELS = {
  queued: { label: "Na fila", tone: "neutral" },
  running: { label: "Em andamento…", tone: "neutral" },
  succeeded: { label: "Concluído", tone: "success" },
  failed: { label: "Falhou", tone: "warning" },
} as const;
const PENDING_REFRESH_INTERVAL_IN_MS = 3000;
const IDLE_REFRESH_INTERVAL_IN_MS = 15_000;

/** Whether a backup or its restore is still in progress. */
export function isBackupPending(backup: Pick<BackupFields, "status" | "restorePending">): boolean {
  return backup.status === "queued" || backup.status === "running" || backup.restorePending;
}

/** Keeps discovering scheduled backups when idle and follows active operations more frequently. */
export function backupRefreshInterval(
  backups: readonly Pick<BackupFields, "status" | "restorePending">[],
): number {
  return backups.some(isBackupPending)
    ? PENDING_REFRESH_INTERVAL_IN_MS
    : IDLE_REFRESH_INTERVAL_IN_MS;
}

/**
 * Describes a backup for its row in the backups dialog.
 *
 * @param backup - Its status and the outcome of its last restore.
 * @returns The tag, a note about the last restore and whether it can be restored.
 */
export function backupState(backup: BackupFields): BackupState {
  if (backup.restorePending) {
    return { label: "Restaurando…", tone: "neutral", restoreNote: null, canRestore: false };
  }
  // The stored reasons are for the logs; people get a message they can act on.
  const restoreNote =
    backup.restoreError == null
      ? null
      : "A última restauração falhou. Confira o banco antes de tentar de novo.";
  return {
    ...STATUS_LABELS[backup.status],
    restoreNote,
    canRestore: backup.status === "succeeded",
  };
}
