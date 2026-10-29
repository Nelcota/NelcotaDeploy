import { formatDateTime, pluralize } from "@/shared/format";
import { WEBHOOK_REASON_LABELS } from "@/web/components/layout/labels";
import { ListRow } from "@/web/components/layout/layout";
import { StatusPill } from "@/web/components/layout/status-badge";
import type { listWebhookDeliveriesFn } from "@/web/functions/settings.functions";

export type WebhookDelivery = Awaited<ReturnType<typeof listWebhookDeliveriesFn>>[number];

/** Characters of commit SHAs shown in the list. */
const SHORT_SHA_LENGTH = 7;

function DeliverySource({ delivery }: { readonly delivery: WebhookDelivery }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="truncate text-sm">
        {delivery.repositoryFullName ?? "—"}
        {delivery.ref == null ? (
          ""
        ) : (
          <span className="text-muted-foreground">
            {` (${delivery.ref.replace("refs/heads/", "")})`}
          </span>
        )}
      </p>
      <p className="font-mono text-xs text-faint">
        {delivery.event} · {delivery.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
      </p>
    </div>
  );
}

function DeliveryOutcome({ delivery }: { readonly delivery: WebhookDelivery }) {
  const accepted = delivery.status === "accepted";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <StatusPill
        tone={accepted ? "success" : "neutral"}
        label={
          accepted ? pluralize(delivery.deploymentIds.length, "deploy", "deploys") : "Ignorado"
        }
      />
      <span className="text-xs text-muted-foreground">
        {WEBHOOK_REASON_LABELS[delivery.reason] ?? delivery.reason}
      </span>
      <span className="text-xs whitespace-nowrap text-faint">
        {formatDateTime(delivery.receivedAt)}
      </span>
    </div>
  );
}

/** One GitHub webhook delivery: where it came from and what it triggered. */
export function WebhookDeliveryRow({ delivery }: { readonly delivery: WebhookDelivery }) {
  return (
    <ListRow className="items-start py-3">
      <DeliverySource delivery={delivery} />
      <DeliveryOutcome delivery={delivery} />
    </ListRow>
  );
}
