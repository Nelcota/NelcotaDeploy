import { HistoryIcon, ShieldIcon } from "lucide-react";

import { Section } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { AuditEventList, LoadOlderEvents } from "./audit-event-list";
import { useAuditEvents } from "./use-audit-events";

/** Records who changed the platform, without mixing webhook processing into the history. */
export function AuditTab() {
  const { query, events, loadMore } = useAuditEvents();
  return (
    <div className="space-y-10">
      <Section icon={HistoryIcon} title="Histórico de ações">
        {query.isError && query.isFetchNextPageError === false ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : null}
        {query.data == null && query.isError === false ? <ListSkeleton /> : null}
        {query.data != null && events.length === 0 ? (
          <EmptyState icon={ShieldIcon} title="Nenhum evento registrado" />
        ) : null}
        {events.length > 0 ? (
          <>
            <AuditEventList events={events} />
            <LoadOlderEvents
              loadingMore={query.isFetching}
              exhausted={query.hasNextPage === false}
              onLoadMore={() => void loadMore()}
            />
          </>
        ) : null}
      </Section>
    </div>
  );
}
