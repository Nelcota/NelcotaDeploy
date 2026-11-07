import { useQuery } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import { ArchiveRestoreIcon, PlusIcon } from "lucide-react";

import { formatBytes, formatDateTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Tag } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { listDatabasesFn } from "@/web/functions/databases/databases.functions";

import { backupState } from "../backup-state";
import { useDatabaseBackups } from "../use-database-backups";

type BackupItem = {
  readonly id: string;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly trigger: "manual" | "scheduled";
  readonly sizeBytes: number | null;
  readonly restoredAt: string | null;
  readonly restoreError: string | null;
  readonly restorePending: boolean;
  readonly createdAt: string;
};

/** Reviews and manages backup copies independently from database provisioning. */
export function DatabaseBackupsPage({
  projectId,
  databaseId,
  mode = "backups",
}: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly mode?: "backups" | "restore";
}) {
  const can = useCan();
  const databases = useQuery({
    queryKey: ["databases", projectId],
    queryFn: () => listDatabasesFn({ data: { projectId } }),
    enabled: mode === "backups" || can("project:delete"),
  });
  if (mode === "restore" && can("project:delete") === false) {
    return <p role="alert">Você não tem permissão para restaurar este banco de dados.</p>;
  }
  if (databases.isError)
    return <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />;
  if (databases.data == null) return <ListSkeleton rows={2} />;
  const database = databases.data.find((item) => item.id === databaseId);
  if (database == null) return <p role="alert">Banco de dados não encontrado neste projeto.</p>;
  if (database.backupsAvailable === false)
    return <p role="status">Backups não estão disponíveis para este banco de dados.</p>;
  return (
    <BackupsContent
      projectId={projectId}
      databaseId={databaseId}
      environmentKey={database.environmentKey}
      mode={mode}
    />
  );
}

function BackupsContent({
  projectId,
  databaseId,
  environmentKey,
  mode,
}: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly environmentKey: string;
  readonly mode: "backups" | "restore";
}) {
  const { backups, backupNow, restore, canBackup, canRestore, busy, operationPending } =
    useDatabaseBackups({ projectId, databaseId, open: true });
  const pending = backupNow.isPending || restore.isPending;
  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: pending });
  return (
    <>
      <Button variant="outline" asChild>
        <Link to="/projects/$projectId/databases" params={{ projectId }}>
          Voltar para bancos de dados
        </Link>
      </Button>
      <TabHeader
        title={mode === "backups" ? `Backups de ${environmentKey}` : `Restaurar ${environmentKey}`}
        description={
          mode === "backups"
            ? "As sete cópias diárias mais recentes ficam criptografadas no armazenamento de backups do painel."
            : "Escolha a cópia que substituirá os dados atuais e confira a confirmação antes de restaurar."
        }
        actions={
          canBackup && mode === "backups" ? (
            <Button disabled={busy} onClick={() => backupNow.mutate()}>
              <PlusIcon aria-hidden />
              Criar backup do banco agora
            </Button>
          ) : undefined
        }
      />
      {canRestore && mode === "backups" ? (
        <Button variant="outline" asChild>
          <Link
            to="/projects/$projectId/databases/$databaseId/restore"
            params={{ projectId, databaseId }}
          >
            Escolher backup para restaurar
          </Link>
        </Button>
      ) : null}
      {operationPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Operação em andamento. Acompanhamos o resultado automaticamente.
        </p>
      ) : null}
      {pending ? (
        <p role="status">Aguarde a confirmação da solicitação antes de sair desta página.</p>
      ) : null}
      {backups.isError ? (
        <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />
      ) : null}
      {backups.data == null && backups.isError === false ? <ListSkeleton rows={2} /> : null}
      {backups.data == null ? null : (
        <BackupList
          backups={backups.data}
          environmentKey={environmentKey}
          canRestore={canRestore && mode === "restore"}
          busy={busy}
          onRestore={(backupId) => restore.mutate(backupId)}
        />
      )}
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
    <ul className="divide-y divide-border/70">
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
              Revisar restauração
            </Button>
          }
          title="Restaurar este backup?"
          description={`Os dados atuais de ${environmentKey} serão substituídos pelo backup de ${formatDateTime(backup.createdAt)}. O que foi gravado depois dele se perde.`}
          confirmLabel="Substituir dados por este backup"
          confirmationText={environmentKey}
          destructive
          onConfirm={onRestore}
        />
      ) : null}
    </li>
  );
}
