import type { Database } from "@/db";
import type { RecoveredJob } from "@/jobs";

import {
  findDatabaseBackup,
  finishBackupRestore,
  markBackupFailed,
} from "./database-backup-outcomes";
import {
  failDatabaseDeletion,
  findDatabaseRecord,
  markDatabaseFailed,
} from "./database-provisioning.service";
import { getProjectDatabase } from "./database.service";

const INTERRUPTION_MESSAGE = "The worker stopped while the database operation was running";

function targetId(job: RecoveredJob, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Recovered job ${job.id} is missing its ${key}`);
  }
  return value;
}

/**
 * Finishes database operations whose interrupted jobs have no attempts left.
 *
 * @param database - Database containing the operation and its job.
 * @param job - Recovered job, including its target payload and queue outcome.
 * @throws {Error} When a database job has no target id.
 */
export function recoverDatabaseJob(database: Database, job: RecoveredJob): void {
  if (job.outcome !== "failed") {
    return;
  }
  if (job.kind === "database_provision") {
    recoverProvision(database, targetId(job, "databaseId"));
    return;
  }
  if (job.kind === "database_delete") {
    failDatabaseDeletion(database, targetId(job, "databaseId"), INTERRUPTION_MESSAGE);
    return;
  }
  if (job.kind === "database_backup") {
    recoverBackup(database, targetId(job, "backupId"));
    return;
  }
  if (job.kind === "database_restore") {
    recoverRestore(database, targetId(job, "backupId"));
  }
}

function recoverProvision(database: Database, id: string): void {
  const record = findDatabaseRecord(database, id);
  if (
    record != null &&
    getProjectDatabase(database, record.projectId, id).status === "provisioning"
  ) {
    markDatabaseFailed(database, id, INTERRUPTION_MESSAGE);
  }
}

function recoverBackup(database: Database, id: string): void {
  const backup = findDatabaseBackup(database, id);
  if (backup?.status === "running" || backup?.status === "queued") {
    markBackupFailed(database, id, INTERRUPTION_MESSAGE);
  }
}

function recoverRestore(database: Database, id: string): void {
  const backup = findDatabaseBackup(database, id);
  if (
    backup != null &&
    getProjectDatabase(database, backup.projectId, backup.databaseId).status === "restoring"
  ) {
    finishBackupRestore(database, backup, INTERRUPTION_MESSAGE);
  }
}
