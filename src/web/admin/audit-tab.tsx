import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, ShieldIcon, WebhookIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatDateTime, pluralize } from "@/shared/format";
import { toUserMessage } from "@/web/components/error-message";
import { AUDIT_ACTION_LABELS, WEBHOOK_REASON_LABELS } from "@/web/components/labels";
import { List, ListRow, Section } from "@/web/components/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { listAuditEventsFn, listWebhookDeliveriesFn } from "@/web/functions/settings.functions";

/** Characters of ids and SHAs shown in tables; the full value is in the audit details. */
const SHORT_ID_LENGTH = 12;
const SHORT_SHA_LENGTH = 7;

type AuditEvent = Awaited<ReturnType<typeof listAuditEventsFn>>[number];

const ACTOR_TYPE_LABELS: Record<string, string> = {
  user: "Usuário",
  token: "Token",
  webhook: "Webhook",
  system: "Sistema",
};

/** Audit events and the latest GitHub webhook deliveries. */
export function AuditTab() {
  const firstPage = useQuery({
    queryKey: ["audit"],
    queryFn: () => listAuditEventsFn({ data: {} }),
  });
  const [olderPages, setOlderPages] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const events = [...(firstPage.data ?? []), ...olderPages];

  const loadMore = async () => {
    const last = events.at(-1);
    if (last == null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listAuditEventsFn({ data: { before: last.createdAt } });
      setOlderPages((current) => [...current, ...page]);
      setExhausted(page.length === 0);
    } catch (error) {
      toast.error(toUserMessage(error, "Não foi possível carregar mais eventos."));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-10">
      <Section
        title="Eventos de auditoria"
        description="Ações administrativas e operacionais. Valores de secrets nunca são registrados."
      >
        {firstPage.isError ? (
          <ErrorState error={firstPage.error} onRetry={() => void firstPage.refetch()} />
        ) : null}
        {firstPage.data == null && firstPage.isError === false ? <ListSkeleton /> : null}
        {firstPage.data?.length === 0 ? (
          <EmptyState icon={ShieldIcon} title="Nenhum evento registrado" />
        ) : null}
        {events.length > 0 ? (
          <List>
            {events.map((event) => (
              <ListRow
                key={event.id}
                className="flex-col items-stretch gap-2 py-3 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">
                      {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {event.targetType}
                      {event.targetId == null ? "" : ` ${event.targetId.slice(-SHORT_ID_LENGTH)}`}
                    </span>
                  </p>
                  {event.details === "" || event.details === "{}" ? null : (
                    <details className="text-xs">
                      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        Ver detalhes
                      </summary>
                      <pre className="mt-1 font-mono break-all whitespace-pre-wrap text-muted-foreground">
                        {event.details}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="space-y-1 text-xs sm:shrink-0 sm:text-right">
                  <p className="break-all">
                    <span className="text-muted-foreground">
                      {ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType}:
                    </span>{" "}
                    {event.actorLabel}
                  </p>
                  <p className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </p>
                </div>
              </ListRow>
            ))}
          </List>
        ) : null}
        {events.length > 0 && exhausted === false ? (
          <div className="flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </Button>
          </div>
        ) : null}
        {events.length > 0 && exhausted ? (
          <p className="text-center text-sm text-muted-foreground">Não há eventos mais antigos.</p>
        ) : null}
      </Section>
      <WebhookDeliveriesCard />
    </div>
  );
}

function WebhookDeliveriesCard() {
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => listWebhookDeliveriesFn(),
  });
  return (
    <Section
      title="Webhooks recebidos"
      description="Entregas do GitHub com assinatura válida, deduplicadas pelo identificador de entrega."
    >
      {deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : null}
      {deliveries.data == null && deliveries.isError === false ? <ListSkeleton rows={2} /> : null}
      {deliveries.data?.length === 0 ? (
        <EmptyState icon={WebhookIcon} title="Nenhum webhook recebido ainda" />
      ) : null}
      {deliveries.data != null && deliveries.data.length > 0 ? (
        <List>
          {deliveries.data.map((delivery) => (
            <ListRow key={delivery.id} className="items-start py-3">
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
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <StatusPill
                  tone={delivery.status === "accepted" ? "success" : "neutral"}
                  label={
                    delivery.status === "accepted"
                      ? pluralize(delivery.deploymentIds.length, "deploy", "deploys")
                      : "Ignorado"
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {WEBHOOK_REASON_LABELS[delivery.reason] ?? delivery.reason}
                </span>
                <span className="text-xs whitespace-nowrap text-faint">
                  {formatDateTime(delivery.receivedAt)}
                </span>
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}
    </Section>
  );
}
