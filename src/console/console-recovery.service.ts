import { and, eq, inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { RecoveredJob } from "@/jobs";

/**
 * Finishes interrupted console commands without repeating an operation whose outcome is unknown.
 *
 * @param database - Database.
 * @param job - Queue recovery outcome; unrelated kinds are ignored.
 * @throws {Error} When a console job has no valid command id.
 */
export function recoverConsoleJob(database: Database, job: RecoveredJob): void {
  if (job.kind !== "console_command") {
    return;
  }
  const commandId = job.payload["commandId"];
  if (typeof commandId !== "string" || commandId.trim() === "") {
    throw new Error(`Recovered console job ${job.id} has no command id`);
  }
  const statuses =
    job.outcome === "failed" ? (["queued", "running"] as const) : (["running"] as const);
  database
    .update(tables.consoleCommands)
    .set({
      status: "failed",
      errorMessage:
        "The worker stopped while the command was pending or running; its outcome is unknown",
      finishedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.consoleCommands.id, commandId),
        inArray(tables.consoleCommands.status, statuses),
      ),
    )
    .run();
}
