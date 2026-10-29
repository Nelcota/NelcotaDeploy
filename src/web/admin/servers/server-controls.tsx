import { Trash2Icon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import {
  removeServerFn,
  setServerAcceptsApplicationsFn,
} from "@/web/functions/admin/servers.functions";

import type { ServerView } from "./use-servers";

/** Whether new projects may be placed on the server automatically. */
export function AcceptsApplicationsSwitch({
  server,
  canEdit,
}: {
  readonly server: ServerView;
  readonly canEdit: boolean;
}) {
  const toggle = useAction({
    action: (acceptsApplications: boolean) =>
      setServerAcceptsApplicationsFn({ data: { serverId: server.id, acceptsApplications } }),
    successMessage: "Servidor atualizado",
    invalidate: [["servers"]],
  });
  const id = `server-accepts-${server.id}`;
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        disabled={canEdit === false || toggle.isPending}
        checked={server.acceptsApplications}
        onCheckedChange={(checked) => toggle.mutate(checked)}
        aria-describedby={`${id}-hint`}
      />
      <div className="space-y-1">
        <Label htmlFor={id}>Recebe novos projetos</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Projetos novos vão para o servidor com menos projetos entre os que recebem.
        </p>
      </div>
    </div>
  );
}

/** Removes a server without projects, after confirmation. */
export function RemoveServerButton({ server }: { readonly server: ServerView }) {
  const remove = useAction({
    action: () => removeServerFn({ data: { serverId: server.id } }),
    successMessage: "Servidor removido",
    invalidate: [["servers"]],
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          <Trash2Icon aria-hidden />
          Remover
        </Button>
      }
      title={`Remover o servidor ${server.name}?`}
      description="O painel deixa de acessar esta VPS. Nada é apagado nela. Só é possível remover um servidor sem projetos."
      confirmLabel="Remover"
      destructive
      onConfirm={() => remove.mutate()}
    />
  );
}
