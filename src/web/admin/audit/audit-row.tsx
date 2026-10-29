import { formatDateTime, formatTime } from "@/shared/format";
import { AUDIT_ACTION_LABELS } from "@/web/components/layout/labels";
import { ListRow } from "@/web/components/layout/layout";
import type { listAuditEventsFn } from "@/web/functions/admin/audit.functions";

import { actorOf, areaOf, targetTypeLabelOf } from "./audit-labels";

export type AuditEvent = Awaited<ReturnType<typeof listAuditEventsFn>>[number];

/** Characters of ids shown in the list; the full value is in the audit details. */
const SHORT_ID_LENGTH = 12;

function AuditHeading({ event }: { readonly event: AuditEvent }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-medium">{AUDIT_ACTION_LABELS[event.action] ?? event.action}</span>
      <span className="text-xs text-muted-foreground">
        {targetTypeLabelOf(event.targetType)}
        {event.targetId == null ? null : (
          <span className="font-mono"> {event.targetId.slice(-SHORT_ID_LENGTH)}</span>
        )}
      </span>
    </p>
  );
}

function AuditActorLine({ event }: { readonly event: AuditEvent }) {
  const actor = actorOf(event.actorType);
  const ActorIcon = actor.icon;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ActorIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="sr-only">{actor.label}: </span>
        <span className="break-all">{event.actorLabel}</span>
      </span>
      <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
        {formatTime(event.createdAt)}
      </time>
    </p>
  );
}

function AuditDetails({ details }: { readonly details: string }) {
  if (details === "" || details === "{}") {
    return null;
  }
  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Ver detalhes
      </summary>
      <pre className="mt-1 font-mono break-all whitespace-pre-wrap text-muted-foreground">
        {details}
      </pre>
    </details>
  );
}

/** One audit event: what happened, to what, by whom and when. */
export function AuditRow({ event }: { readonly event: AuditEvent }) {
  const AreaIcon = areaOf(event.action).icon;
  return (
    <ListRow className="items-start gap-3 py-3">
      <AreaIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <AuditHeading event={event} />
        <AuditActorLine event={event} />
        <AuditDetails details={event.details} />
      </div>
    </ListRow>
  );
}
