import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

export function VolumeReviewDialog({
  mountPath,
  serverName,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  readonly mountPath: string;
  readonly serverName: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open === false && pending === false) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar novo volume</DialogTitle>
          <DialogDescription>
            Os arquivos desta pasta serão mantidos entre os próximos deploys.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Caminho no contêiner</dt>
            <dd className="font-mono break-all">{mountPath}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Servidor</dt>
            <dd>{serverName}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          O volume usará o disco deste servidor. Se a aplicação automática estiver ativada, o
          contêiner será recriado para montar a pasta. Uma montagem pode ocultar os arquivos que
          estavam nesse caminho no contêiner atual; este fluxo não migra esses arquivos.
        </p>
        {error == null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Voltar para editar volume
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Adicionando…" : "Adicionar volume ao projeto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
