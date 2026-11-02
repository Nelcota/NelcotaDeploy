import { and, eq, gt, inArray, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Logger } from "pino";

import { findDatabaseBackup, findDatabaseRecord } from "@/databases";
import { type Database, tables, type Transaction } from "@/db";
import type { Job } from "@/jobs";
import { listProjectVolumes } from "@/volumes";

import { handleRecoveredJobs } from "../job-recovery";

function latestFailedResources(transaction: Transaction): Job[] {
  const newer = alias(tables.jobs, "newer_resource_job");
  return transaction
    .select()
    .from(tables.jobs)
    .where(
      and(
        eq(tables.jobs.status, "failed"),
        inArray(tables.jobs.kind, [
          "database_provision",
          "database_delete",
          "volume_delete",
          "database_backup",
          "database_restore",
        ]),
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

function needsRecovery(database: Database, job: Job): boolean {
  const databaseId = job.payload["databaseId"];
  const record = typeof databaseId === "string" ? findDatabaseRecord(database, databaseId) : null;
  if (job.kind === "database_provision") {
    return record?.status === "provisioning";
  }
  if (job.kind === "database_delete") {
    return record?.deletionRequestedAt != null;
  }
  if (job.kind === "volume_delete") {
    return listProjectVolumes(database, job.projectId).some(
      (volume) => volume.id === job.payload["volumeId"] && volume.deletionRequestedAt != null,
    );
  }
  const backupId = job.payload["backupId"];
  const backup = typeof backupId === "string" ? findDatabaseBackup(database, backupId) : null;
  if (job.kind === "database_backup") {
    return backup?.status === "queued" || backup?.status === "running";
  }
  return backup != null && findDatabaseRecord(database, backup.databaseId)?.status === "restoring";
}

/** Repairs states stranded by failed jobs from before resource-aware crash recovery existed. */
export function recoverFailedResources(database: Database, logger: Logger): number {
  return database.transaction(
    (transaction) => {
      const stranded = latestFailedResources(transaction).filter((job) =>
        needsRecovery(database, job),
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
