import { DatabaseIcon, RotateCwIcon, Trash2Icon } from "lucide-react";

import type { DatabaseEngineName } from "@/shared/schemas/database.schema";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow, Tag } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { DatabaseBackupsButton } from "./database-backups-dialog";
import { databaseState, ENGINE_LABELS, engineVersion } from "./database-state";

type DatabaseItem = {
  readonly id: string;
  readonly engine: DatabaseEngineName;
  readonly imageTag: string;
  readonly environmentKey: string;
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
  readonly databaseName: string | null;
  readonly status: "provisioning" | "running" | "failed" | "restoring";
  readonly errorMessage: string | null;
  readonly deletionRequestedAt: string | null;
  readonly backupsAvailable: boolean;
};

/** One database: engine, state, how applications reach it and the actions the user may take. */
export function DatabaseRow({
  projectId,
  database,
  canEdit,
  canDelete,
  busy,
  onRetry,
  onDelete,
}: {
  readonly projectId: string;
  readonly database: DatabaseItem;
  readonly canEdit: boolean;
  /** The user may delete data, which only admins can. */
  readonly canDelete: boolean;
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onDelete: () => void;
}) {
  const state = databaseState(database);
  return (
    <ListRow className="flex-col items-start sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2">
          <DatabaseIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">
            {ENGINE_LABELS[database.engine]} {engineVersion(database.imageTag)}
          </span>
          <Tag tone={state.tone}>{state.label}</Tag>
        </p>
        <ConnectionFacts database={database} />
        {state.failureNote == null ? null : (
          <p className="text-xs text-warning">{state.failureNote}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {database.backupsAvailable && database.deletionRequestedAt == null ? (
          <DatabaseBackupsButton
            projectId={projectId}
            databaseId={database.id}
            environmentKey={database.environmentKey}
          />
        ) : null}
        {canEdit && state.canRetry ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
            <RotateCwIcon aria-hidden />
            Tentar de novo
          </Button>
        ) : null}
        {canDelete && state.canDelete ? (
          <DeleteDatabaseButton
            environmentKey={database.environmentKey}
            busy={busy}
            onConfirm={onDelete}
          />
        ) : null}
      </div>
    </ListRow>
  );
}

function ConnectionFacts({ database }: { readonly database: DatabaseItem }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <div className="flex gap-1">
        <dt>Variável:</dt>
        <dd className="font-mono text-foreground">{database.environmentKey}</dd>
      </div>
      <div className="flex gap-1">
        <dt className="shrink-0">Endereço interno:</dt>
        <dd className="font-mono break-all">
          {database.host}:{database.port}
        </dd>
      </div>
      {database.user == null ? null : (
        <div className="flex gap-1">
          <dt>Usuário:</dt>
          <dd className="font-mono">{database.user}</dd>
        </div>
      )}
      {database.databaseName == null ? null : (
        <div className="flex gap-1">
          <dt>Banco:</dt>
          <dd className="font-mono">{database.databaseName}</dd>
        </div>
      )}
    </dl>
  );
}

function DeleteDatabaseButton({
  environmentKey,
  busy,
  onConfirm,
}: {
  readonly environmentKey: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={busy}>
          <Trash2Icon aria-hidden />
          Excluir
        </Button>
      }
      title="Excluir este banco de dados?"
      description={`O banco e todos os seus dados são apagados do servidor, e a variável ${environmentKey} é removida do projeto. Não há como desfazer.`}
      confirmLabel="Excluir banco"
      confirmationText={environmentKey}
      destructive
      onConfirm={onConfirm}
    />
  );
}
