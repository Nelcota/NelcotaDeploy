import { LoaderCircleIcon } from "lucide-react";
import { Fragment } from "react";

import { dayKey, formatDayHeading } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { DayHeading, List } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { type AuditEvent, AuditRow } from "./audit-row";

/** Audit events grouped under a heading for each day. */
export function AuditEventList({ events }: { readonly events: readonly AuditEvent[] }) {
  const now = useNow();
  const eventsByDay = Map.groupBy(events, (event) => dayKey(event.createdAt) ?? event.createdAt);
  return (
    <List>
      {[...eventsByDay].map(([day, items]) => (
        <Fragment key={day}>
          <DayHeading>{formatDayHeading(items[0]?.createdAt ?? "", now)}</DayHeading>
          {items.map((event) => (
            <AuditRow key={event.id} event={event} />
          ))}
        </Fragment>
      ))}
    </List>
  );
}

/** Button that loads older events, or a note once there are none left. */
export function LoadOlderEvents({
  loadingMore,
  exhausted,
  onLoadMore,
}: {
  readonly loadingMore: boolean;
  readonly exhausted: boolean;
  readonly onLoadMore: () => void;
}) {
  if (exhausted) {
    return (
      <p className="text-center text-sm text-muted-foreground">Não há eventos mais antigos.</p>
    );
  }
  return (
    <div className="flex justify-center">
      <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
        {loadingMore ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        {loadingMore ? "Carregando…" : "Carregar mais"}
      </Button>
    </div>
  );
}
