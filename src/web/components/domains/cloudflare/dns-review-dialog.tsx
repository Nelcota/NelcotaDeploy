import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import type { previewCloudflareDnsFn } from "@/web/functions/domains/cloudflare.functions";

export type DnsReview = Awaited<ReturnType<typeof previewCloudflareDnsFn>>;
const ACTION_LABELS = { create: "Criar", update: "Atualizar", delete: "Remover" };

/** The exact provider changes the user authorizes; mail and verification records are not modified. */
export function DnsReviewDialog({
  review,
  pending,
  onClose,
  onConfirm,
}: {
  readonly review: DnsReview;
  readonly pending: boolean;
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar configuração de DNS</DialogTitle>
          <DialogDescription>
            Domínio {review.hostname} · Zona {review.zone}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          O domínio apontará para{" "}
          <span className="font-mono text-foreground">{review.desired.content}</span>, o IP do
          servidor deste projeto.
        </p>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border">
          {review.changes.map((change, index) => (
            <li key={change.before?.id ?? `new-${index}`} className="space-y-1 px-3 py-3 text-sm">
              <p
                className={change.action === "delete" ? "font-medium text-warning" : "font-medium"}
              >
                {ACTION_LABELS[change.action]} registro {change.before?.type ?? change.after?.type}
              </p>
              {change.before == null ? null : (
                <p className="font-mono break-all text-muted-foreground">
                  Atual: {change.before.name} → {change.before.content}
                </p>
              )}
              {change.after == null ? null : (
                <p className="font-mono break-all">
                  Novo: {change.after.name} → {change.after.content}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Proxy Cloudflare: {review.desired.proxied ? "ativado" : "desativado"}. Registros de e-mail
          e verificação serão preservados. A propagação pode levar algum tempo.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Voltar sem alterar DNS
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Aplicando…" : "Aplicar registros DNS na Cloudflare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
