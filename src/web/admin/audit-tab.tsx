import { useQuery } from "@tanstack/react-query";
import {
  BoxesIcon,
  ClockIcon,
  ContainerIcon,
  GlobeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  type LucideIcon,
  RocketIcon,
  ServerIcon,
  ShieldIcon,
  UserRoundIcon,
  UsersIcon,
  VariableIcon,
  WebhookIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { dayKey, formatDateTime, formatDayHeading, formatTime, pluralize } from "@/shared/format";
import { toUserMessage } from "@/web/components/error-message";
import { AUDIT_ACTION_LABELS, WEBHOOK_REASON_LABELS } from "@/web/components/labels";
import { DayHeading, List, ListRow, Section } from "@/web/components/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { listAuditEventsFn, listWebhookDeliveriesFn } from "@/web/functions/settings.functions";

/** Characters of ids and SHAs shown in tables; the full value is in the audit details. */
const SHORT_ID_LENGTH = 12;
const SHORT_SHA_LENGTH = 7;

type AuditEvent = Awaited<ReturnType<typeof listAuditEventsFn>>[number];

const ACTOR_TYPES: Record<string, { readonly label: string; readonly icon: LucideIcon }> = {
  user: { label: "Usuário", icon: UserRoundIcon },
  token: { label: "Token", icon: KeyRoundIcon },
  webhook: { label: "Webhook", icon: WebhookIcon },
  system: { label: "Sistema", icon: ServerIcon },
};

/** Icon of each audited area, the part of the action code before the dot. */
const AREA_ICONS: Record<string, LucideIcon> = {
  deployment: RocketIcon,
  environment_variable: VariableIcon,
  domain: GlobeIcon,
  task: ClockIcon,
  project: BoxesIcon,
  user: UsersIcon,
  api_token: KeyRoundIcon,
  container: ContainerIcon,
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  task: "Task",
  project: "Projeto",
  deployment: "Deploy",
  user: "Usuário",
  api_token: "Token",
  domain: "Domínio",
  environment_variable: "Variável",
  container: "Contêiner",
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
  const now = new Date();

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
        icon={HistoryIcon}
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
            {[...Map.groupBy(events, (event) => dayKey(event.createdAt) ?? event.createdAt)].map(
              ([day, items]) => (
                <Fragment key={day}>
                  <DayHeading>{formatDayHeading(items[0]?.createdAt ?? "", now)}</DayHeading>
                  {items.map((event) => (
                    <AuditRow key={event.id} event={event} />
                  ))}
                </Fragment>
              ),
            )}
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

function AuditRow({ event }: { readonly event: AuditEvent }) {
  const AreaIcon = AREA_ICONS[event.action.split(".")[0] ?? ""] ?? HistoryIcon;
  const actor = ACTOR_TYPES[event.actorType];
  const ActorIcon = actor?.icon ?? UserRoundIcon;
  return (
    <ListRow className="items-start gap-3 py-3">
      <AreaIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{AUDIT_ACTION_LABELS[event.action] ?? event.action}</span>
          <span className="text-xs text-muted-foreground">
            {TARGET_TYPE_LABELS[event.targetType] ?? event.targetType}
            {event.targetId == null ? null : (
              <span className="font-mono"> {event.targetId.slice(-SHORT_ID_LENGTH)}</span>
            )}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ActorIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only">{actor?.label ?? event.actorType}: </span>
            <span className="break-all">{event.actorLabel}</span>
          </span>
          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
            {formatTime(event.createdAt)}
          </time>
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
    </ListRow>
  );
}

function WebhookDeliveriesCard() {
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => listWebhookDeliveriesFn(),
  });
  return (
    <Section
      icon={WebhookIcon}
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
