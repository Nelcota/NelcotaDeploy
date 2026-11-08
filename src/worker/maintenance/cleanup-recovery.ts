import { and, eq, inArray, notExists, or, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type Database, tables, type Transaction } from "@/db";
import { CLEANUP_MAX_ATTEMPTS, enqueueJob, type Job } from "@/jobs";
import { getPreview } from "@/previews";

function latestFailedCleanups(transaction: Transaction): Job[] {
  const newer = alias(tables.jobs, "newer_cleanup");
  return transaction
    .select()
    .from(tables.jobs)
    .where(
      and(
        eq(tables.jobs.status, "failed"),
        inArray(tables.jobs.kind, ["project_cleanup", "preview_cleanup"]),
        notExists(
          transaction
            .select({ id: newer.id })
            .from(newer)
            .where(
              and(
                eq(newer.dedupeKey, tables.jobs.dedupeKey),
                or(
                  gt(newer.createdAt, tables.jobs.createdAt),
                  and(eq(newer.createdAt, tables.jobs.createdAt), gt(newer.id, tables.jobs.id)),
                ),
              ),
            ),
        ),
      ),
    )
    .all();
}

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
      const failed = latestFailedCleanups(transaction);
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
