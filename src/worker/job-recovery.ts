import type { Logger } from "pino";

import type { Database } from "@/db";
import type { RecoveredJob } from "@/jobs";

import { jobHandlerFor } from "./job-dispatch";

const DEFAULT_RECOVERY_REASON = "The worker stopped while the operation was running";

/**
 * Brings deployments, databases, backups and task executions interrupted by a crash back in line with
 * what the queue decided for them.
 *
 * @param database - Database.
 * @param logger - Worker logger.
 * @param recovered - Jobs the queue requeued or failed.
 */
export function handleRecoveredJobs(
  database: Database,
  logger: Logger,
  recovered: readonly RecoveredJob[],
): void {
  for (const job of recovered) {
    const reason = job.reason ?? DEFAULT_RECOVERY_REASON;
    jobHandlerFor(job.kind).recover(database, job, reason);
    logger.warn(
      { jobId: job.id, kind: job.kind, outcome: job.outcome },
      "recovered interrupted job",
    );
  }
}
