import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { Input } from "@/web/components/ui/input";

import { isUnreachableFromInternet } from "../public-url";
import { ToggleStatusPill } from "../toggle-status-pill";

/** Warns when GitHub cannot reach the panel, which both the app and the webhook need. */
export function UnreachableWarning({ webhookUrl }: { readonly webhookUrl: string }) {
  if (isUnreachableFromInternet(webhookUrl) === false) {
    return null;
  }
  return (
    <p className="flex items-start gap-1.5 text-sm text-warning">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />O GitHub não alcança este
      painel. Defina PUBLIC_URL com o endereço público dele.
    </p>
  );
}

/** The webhook set up by hand, folded away since the GitHub App does it on its own. */
export function ManualWebhook({
  webhookUrl,
  webhookConfigured,
}: {
  readonly webhookUrl: string;
  readonly webhookConfigured: boolean;
}) {
  return (
    <details className="group max-w-2xl">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        Configurar o webhook à mão
      </summary>
      <div className="mt-4 space-y-4">
        <div className="flex gap-2">
          <Input readOnly aria-label="URL do webhook" className="font-mono" value={webhookUrl} />
          <CopyButton text={webhookUrl} label="Copiar" />
        </div>
        <div>
          <ToggleStatusPill
            on={webhookConfigured}
            onLabel="Segredo configurado"
            offLabel="GITHUB_WEBHOOK_SECRET ausente"
            offTone="warning"
          />
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>No repositório, abra Settings → Webhooks → Add webhook.</li>
          <li>Payload URL: a URL acima. Content type: application/json.</li>
          <li>Secret: o mesmo valor de GITHUB_WEBHOOK_SECRET do servidor.</li>
          <li>Eventos: “Just the push event”.</li>
        </ol>
      </div>
    </details>
  );
}
