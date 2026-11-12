import type { Logger } from "pino";

import type { Database } from "@/db";
import { type JobKind, listLatestFailedJobs } from "@/jobs";

import { jobHandlerFor } from "../job-dispatch";
import { handleRecoveredJobs } from "../job-recovery";

const RECOVERABLE_RESOURCE_KINDS = [
  "database_provision",
  "database_delete",
  "volume_delete",
  "database_backup",
  "database_restore",
] as const satisfies readonly JobKind[];

/** Repairs states stranded by failed jobs from before resource-aware crash recovery existed. */
export function recoverFailedResources(database: Database, logger: Logger): number {
  return database.transaction(
    (transaction) => {
      const stranded = listLatestFailedJobs(transaction, RECOVERABLE_RESOURCE_KINDS).filter((job) =>
        jobHandlerFor(job.kind).isStranded(database, job),
      );
      handleRecoveredJobs(
        database,
        logger,
        stranded.map((job) => ({
          ...job,
          outcome: "failed" as const,
          reason: job.lastError ?? "The worker stopped while the operation was running",
        })),
      );
      return stranded.length;
    },
    { behavior: "immediate" },
  );
}
