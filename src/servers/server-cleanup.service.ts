import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";

/**
 * Records the outcome of the daily cleanup of a server, for the servers page.
 *
 * @param database - Database.
 * @param serverId - Server that was cleaned.
 * @param cleanup - When it ran, in UTC, and the non-negative safe integer `freedBytes` Docker reported.
 * @throws {RangeError} When the timestamp or freed byte count is invalid.
 */
export function recordServerCleanup(
  database: Database,
  serverId: string,
  cleanup: { readonly at: Date; readonly freedBytes: number },
): void {
  if (Number.isNaN(cleanup.at.getTime())) {
    throw new RangeError(
      `Invalid cleanup timestamp for server ${serverId}: ${cleanup.at.toString()}`,
    );
  }
  if (Number.isSafeInteger(cleanup.freedBytes) === false || cleanup.freedBytes < 0) {
    throw new RangeError(
      `Invalid cleanup byte count for server ${serverId}: ${cleanup.freedBytes}`,
    );
  }
  database
    .update(tables.servers)
    .set({
      lastCleanupAt: cleanup.at.toISOString(),
      lastCleanupFreedBytes: cleanup.freedBytes,
    })
    .where(eq(tables.servers.id, serverId))
    .run();
}
