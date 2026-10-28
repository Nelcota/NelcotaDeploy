import { desc, lt } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";

/** Who performed an audited action. */
export type Actor =
  | { readonly type: "user"; readonly id: string; readonly label: string }
  | { readonly type: "token"; readonly id: string; readonly label: string }
  | { readonly type: "webhook"; readonly label: string }
  | { readonly type: "system"; readonly label: string };

export type AuditEntry = {
  readonly actor: Actor;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Never put secret values here; the metadata is shown to every admin. */
  readonly metadata?: Record<string, unknown>;
};

const MAX_PAGE_SIZE = 100;

/**
 * Records an audit event.
 *
 * @param database - Database or open transaction.
 * @param entry - Action to record.
 */
export function recordAuditEvent(database: Database | Transaction, entry: AuditEntry): void {
  database
    .insert(tables.auditEvents)
    .values({
      id: Bun.randomUUIDv7(),
      actorType: entry.actor.type,
      actorId: entry.actor.type === "user" || entry.actor.type === "token" ? entry.actor.id : null,
      actorLabel: entry.actor.label,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      createdAt: new Date().toISOString(),
    })
    .run();
}

/**
 * Lists audit events, newest first.
 *
 * @param database - Database.
 * @param options - `before` is the createdAt cursor of the last item already shown.
 * @returns Up to `limit` events (at most 100).
 */
export function listAuditEvents(
  database: Database,
  options: { readonly limit: number; readonly before?: string | undefined },
) {
  const limit = Math.min(Math.max(options.limit, 1), MAX_PAGE_SIZE);
  return database
    .select({
      id: tables.auditEvents.id,
      actorType: tables.auditEvents.actorType,
      actorLabel: tables.auditEvents.actorLabel,
      action: tables.auditEvents.action,
      targetType: tables.auditEvents.targetType,
      targetId: tables.auditEvents.targetId,
      metadata: tables.auditEvents.metadata,
      createdAt: tables.auditEvents.createdAt,
    })
    .from(tables.auditEvents)
    .where(options.before == null ? undefined : lt(tables.auditEvents.createdAt, options.before))
    .orderBy(desc(tables.auditEvents.createdAt))
    .limit(limit)
    .all();
}
