import type { Database, Transaction } from "@/db";
import { CLEANUP_MAX_ATTEMPTS, enqueueJob, type Job, listLatestFailedJobs } from "@/jobs";
import { getPreview } from "@/previews";

function cleanupStillRequested(transaction: Transaction, job: Job): boolean {
  if (job.kind !== "preview_cleanup") {
    return true;
  }
  const previewId = job.payload["previewId"];
  return typeof previewId === "string" && getPreview(transaction, previewId)?.status === "closed";
}

/** Retries the latest failed cleanup requests until every remote resource was removed. */
export function requeueFailedCleanups(database: Database): number {
  return database.transaction(
    (transaction) => {
      const failed = listLatestFailedJobs(transaction, ["project_cleanup", "preview_cleanup"]);
      let queued = 0;
      for (const job of failed) {
        if (cleanupStillRequested(transaction, job) === false) {
          continue;
        }
        const next = enqueueJob(transaction, {
          kind: job.kind,
          projectId: job.projectId,
          payload: job.payload,
          dedupeKey: job.dedupeKey,
          maxAttempts: CLEANUP_MAX_ATTEMPTS,
        });
        if (next.created) {
          queued += 1;
        }
      }
      return queued;
    },
    { behavior: "immediate" },
  );
}
