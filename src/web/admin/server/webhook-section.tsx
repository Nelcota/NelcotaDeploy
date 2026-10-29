import { TriangleAlertIcon, WebhookIcon } from "lucide-react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { Section } from "@/web/components/layout/layout";
import { Input } from "@/web/components/ui/input";

import { isUnreachableFromInternet } from "./public-url";
import { ToggleStatusPill } from "./toggle-status-pill";

/** GitHub webhook URL, whether its secret is set and how to register it. */
export function WebhookSection({
  webhookUrl,
  webhookConfigured,
}: {
  readonly webhookUrl: string;
  readonly webhookConfigured: boolean;
}) {
  return (
    <Section
      icon={WebhookIcon}
      title="Webhook do GitHub"
      description="Deploy automático a cada push na branch configurada de projetos com deploy automático ativo."
    >
      <div className="flex max-w-2xl gap-2">
        <Input readOnly aria-label="URL do webhook" className="font-mono" value={webhookUrl} />
        <CopyButton text={webhookUrl} label="Copiar" />
      </div>
      {isUnreachableFromInternet(webhookUrl) ? (
        <p className="flex items-start gap-1.5 text-sm text-warning">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Esta URL não é acessível pelo GitHub. Defina PUBLIC_URL com o endereço público do painel.
        </p>
      ) : null}
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
    </Section>
  );
}
