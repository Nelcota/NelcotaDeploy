import type { DatabaseInput } from "@/shared/schemas/database.schema";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { ENGINE_LABELS } from "../database-state";

export function DatabaseReviewDialog({
  input,
  serverName,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  readonly input: DatabaseInput;
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
          <DialogTitle>Confirmar criação do banco</DialogTitle>
          <DialogDescription>
            Confira o recurso que será criado no servidor do projeto.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Banco</dt>
          <dd>{ENGINE_LABELS[input.engine]}</dd>
          <dt className="text-muted-foreground">Servidor</dt>
          <dd className="break-all">{serverName}</dd>
          <dt className="text-muted-foreground">Variável</dt>
          <dd className="font-mono break-all">{input.environmentKey}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          A senha e a URL de conexão serão geradas automaticamente. A URL será salva como secret,
          fora dos previews. O banco usará disco e memória deste servidor. Se a aplicação automática
          estiver ativada, o contêiner da aplicação será recriado para receber a variável.
        </p>
        {error == null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Voltar para editar banco
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Criando…" : "Criar banco de dados"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
