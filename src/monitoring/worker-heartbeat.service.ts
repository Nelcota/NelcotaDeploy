import { desc } from "drizzle-orm";

import { type Database, tables } from "@/db";

/** A worker is considered offline after this long without a heartbeat. */
const WORKER_OFFLINE_AFTER_IN_MS = 30_000;

/**
 * Records that a worker is alive.
 *
 * @param database - Database.
 * @param heartbeat - Worker identity and Docker availability.
 */
export function recordWorkerHeartbeat(
  database: Database,
  heartbeat: {
    readonly workerId: string;
    readonly startedAt: string;
    readonly dockerAvailable: boolean;
    readonly dockerVersion: string | null;
    readonly now?: Date;
  },
): void {
  const values = {
    workerId: heartbeat.workerId,
    startedAt: heartbeat.startedAt,
    lastSeenAt: (heartbeat.now ?? new Date()).toISOString(),
    dockerAvailable: heartbeat.dockerAvailable,
    dockerVersion: heartbeat.dockerVersion,
  };
  database
    .insert(tables.workerHeartbeats)
    .values(values)
    .onConflictDoUpdate({ target: tables.workerHeartbeats.workerId, set: values })
    .run();
}

/**
 * Returns the most recently seen worker and whether it is online.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns Worker status, or null when no worker ever ran.
 */
export function getWorkerStatus(database: Database, now: Date = new Date()) {
  const worker = database
    .select({
      workerId: tables.workerHeartbeats.workerId,
      startedAt: tables.workerHeartbeats.startedAt,
      lastSeenAt: tables.workerHeartbeats.lastSeenAt,
      dockerAvailable: tables.workerHeartbeats.dockerAvailable,
      dockerVersion: tables.workerHeartbeats.dockerVersion,
    })
    .from(tables.workerHeartbeats)
    .orderBy(desc(tables.workerHeartbeats.lastSeenAt))
    .limit(1)
    .get();
  if (worker == null) {
    return null;
  }
  const online = now.getTime() - new Date(worker.lastSeenAt).getTime() < WORKER_OFFLINE_AFTER_IN_MS;
  return { ...worker, online, dockerAvailable: online && worker.dockerAvailable };
}
