import { HardDriveIcon, Trash2Icon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Tag } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { volumeState } from "./volume-state";

type Volume = {
  readonly id: string;
  readonly mountPath: string;
  readonly attached: boolean;
  readonly deletionRequestedAt: string | null;
  readonly deletionError: string | null;
};

/** One volume: its path, its state and the actions the user may take. */
export function VolumeRow({
  volume,
  canEdit,
  canDeleteData,
  busy,
  onToggle,
  onDeleteData,
}: {
  readonly volume: Volume;
  readonly canEdit: boolean;
  /** The user may delete data, which only admins can. */
  readonly canDeleteData: boolean;
  readonly busy: boolean;
  readonly onToggle: (attached: boolean) => void;
  readonly onDeleteData: () => void;
}) {
  const state = volumeState(volume);
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2">
          <HardDriveIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm">{volume.mountPath}</span>
          <Tag tone={state.tone}>{state.label}</Tag>
        </p>
        {state.failureNote == null ? null : (
          <p className="text-xs text-warning">{state.failureNote}</p>
        )}
      </div>
      <div className="flex max-w-full flex-wrap gap-2">
        {canEdit && state.canToggle ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={busy}>
                {volume.attached ? "Desconectar volume" : "Conectar volume"}
              </Button>
            }
            title={
              volume.attached
                ? "Desconectar este volume da aplicação?"
                : "Conectar este volume à aplicação?"
            }
            description={
              <>
                <span className="font-mono break-all">{volume.mountPath}</span>.{" "}
                {volume.attached
                  ? "Os dados serão preservados no servidor, mas deixarão de aparecer nesse caminho da aplicação."
                  : "Os dados guardados no volume aparecerão nesse caminho e poderão ocultar os arquivos da imagem."}{" "}
                Se a opção de aplicar alterações automaticamente estiver ativada, o contêiner será
                recriado.
              </>
            }
            confirmLabel={volume.attached ? "Desconectar volume" : "Conectar volume"}
            onConfirm={() => onToggle(volume.attached === false)}
          />
        ) : null}
        {canDeleteData && state.canDeleteData ? (
          <DeleteDataButton mountPath={volume.mountPath} busy={busy} onConfirm={onDeleteData} />
        ) : null}
      </div>
    </li>
  );
}

function DeleteDataButton({
  mountPath,
  busy,
  onConfirm,
}: {
  readonly mountPath: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={busy}>
          <Trash2Icon aria-hidden />
          Apagar dados do volume
        </Button>
      }
      title="Apagar os dados deste volume?"
      description="Todos os arquivos guardados nesta pasta são apagados do servidor. Não há como desfazer."
      confirmLabel="Apagar dados do volume"
      confirmationText={mountPath}
      destructive
      onConfirm={onConfirm}
    />
  );
}
