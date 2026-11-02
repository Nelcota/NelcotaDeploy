import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";

/**
 * Records the outcome of the daily cleanup of a server, for the servers page.
 *
 * @param database - Database.
 * @param serverId - Server that was cleaned.
 * @param cleanup - When it ran, in UTC, and how many `freedBytes` Docker reported.
 */
export function recordServerCleanup(
  database: Database,
  serverId: string,
  cleanup: { readonly at: Date; readonly freedBytes: number },
): void {
  database
    .update(tables.servers)
    .set({
      lastCleanupAt: cleanup.at.toISOString(),
      lastCleanupFreedBytes: cleanup.freedBytes,
    })
    .where(eq(tables.servers.id, serverId))
    .run();
}
