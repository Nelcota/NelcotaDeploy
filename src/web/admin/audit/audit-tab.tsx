import { HistoryIcon, ShieldIcon } from "lucide-react";

import { Section } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { AuditEventList, LoadOlderEvents } from "./audit-event-list";
import { useAuditEvents } from "./use-audit-events";
import { WebhookDeliveriesSection } from "./webhook-deliveries-section";

/** Audit events and the latest GitHub webhook deliveries. */
export function AuditTab() {
  const { firstPage, events, loadingMore, exhausted, loadMore } = useAuditEvents();
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
          <>
            <AuditEventList events={events} />
            <LoadOlderEvents
              loadingMore={loadingMore}
              exhausted={exhausted}
              onLoadMore={() => void loadMore()}
            />
          </>
        ) : null}
      </Section>
      <WebhookDeliveriesSection />
    </div>
  );
}
