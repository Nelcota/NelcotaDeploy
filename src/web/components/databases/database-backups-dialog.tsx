import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { formatBytes, formatDateTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Tag } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { backupState } from "./backup-state";
import { useDatabaseBackups } from "./use-database-backups";

type BackupItem = {
  readonly id: string;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly trigger: "manual" | "scheduled";
  readonly sizeBytes: number | null;
  readonly restoredAt: string | null;
  readonly restoreError: string | null;
  readonly createdAt: string;
};

/** Button that opens the backups of a database: list, back up now and restore. */
export function DatabaseBackupsButton({
  projectId,
  databaseId,
  environmentKey,
}: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly environmentKey: string;
}) {
  const [open, setOpen] = useState(false);
  const { backups, backupNow, restore, canBackup, canRestore } = useDatabaseBackups({
    projectId,
    databaseId,
    open,
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ArchiveIcon aria-hidden />
        Backups
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Backups do banco</DialogTitle>
            <DialogDescription>
              Um backup por dia é feito automaticamente, e os sete mais recentes ficam guardados,
              criptografados, no bucket configurado ou na pasta de backups do painel.
            </DialogDescription>
          </DialogHeader>
          {canBackup ? (
            <Button
              className="justify-self-start"
              disabled={backupNow.isPending}
              onClick={() => backupNow.mutate()}
            >
              <PlusIcon aria-hidden />
              Fazer backup agora
            </Button>
          ) : null}
          {backups.isError ? (
            <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />
          ) : null}
          {backups.data == null ? (
            <ListSkeleton rows={2} />
          ) : (
            <BackupList
              backups={backups.data}
              environmentKey={environmentKey}
              canRestore={canRestore}
              busy={restore.isPending}
              onRestore={(backupId) => restore.mutate(backupId)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BackupList({
  backups,
  environmentKey,
  canRestore,
  busy,
  onRestore,
}: {
  readonly backups: readonly BackupItem[];
  readonly environmentKey: string;
  readonly canRestore: boolean;
  readonly busy: boolean;
  readonly onRestore: (backupId: string) => void;
}) {
  if (backups.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum backup ainda.</p>;
  }
  return (
    <ul className="max-h-80 divide-y divide-border/70 overflow-y-auto">
      {backups.map((backup) => (
        <BackupRow
          key={backup.id}
          backup={backup}
          environmentKey={environmentKey}
          canRestore={canRestore}
          busy={busy}
          onRestore={() => onRestore(backup.id)}
        />
      ))}
    </ul>
  );
}

function BackupRow({
  backup,
  environmentKey,
  canRestore,
  busy,
  onRestore,
}: {
  readonly backup: BackupItem;
  readonly environmentKey: string;
  readonly canRestore: boolean;
  readonly busy: boolean;
  readonly onRestore: () => void;
}) {
  const state = backupState(backup);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{formatDateTime(backup.createdAt)}</span>
          <Tag tone={state.tone}>{state.label}</Tag>
        </p>
        <p className="text-xs text-muted-foreground">
          {backup.trigger === "scheduled" ? "Automático" : "Manual"}
          {backup.sizeBytes == null ? null : ` · ${formatBytes(backup.sizeBytes)}`}
          {backup.restoredAt == null
            ? null
            : ` · restaurado em ${formatDateTime(backup.restoredAt)}`}
        </p>
        {state.restoreNote == null ? null : (
          <p className="text-xs text-warning">{state.restoreNote}</p>
        )}
      </div>
      {canRestore && state.canRestore ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm" disabled={busy}>
              <ArchiveRestoreIcon aria-hidden />
              Restaurar
            </Button>
          }
          title="Restaurar este backup?"
          description="Os dados atuais do banco são substituídos pelos deste backup. O que foi gravado depois dele se perde."
          confirmLabel="Restaurar"
          confirmationText={environmentKey}
          destructive
          onConfirm={onRestore}
        />
      ) : null}
    </li>
  );
}
