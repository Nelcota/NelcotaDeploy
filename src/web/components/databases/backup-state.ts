/** Fields of a backup that decide what its row shows and allows. */
type BackupFields = {
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly restoredAt: string | null;
  readonly restoreError: string | null;
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

/**
 * Describes a backup for its row in the backups dialog.
 *
 * @param backup - Its status and the outcome of its last restore.
 * @returns The tag, a note about the last restore and whether it can be restored.
 */
export function backupState(backup: BackupFields): BackupState {
  // The stored reasons are for the logs; people get a message they can act on.
  const restoreNote =
    backup.restoreError == null
      ? null
      : "A última restauração falhou e pode ter deixado parte dos dados substituída. Tente de novo.";
  return {
    ...STATUS_LABELS[backup.status],
    restoreNote,
    canRestore: backup.status === "succeeded",
  };
}
