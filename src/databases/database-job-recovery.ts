import type { Database } from "@/db";
import { type Job, type RecoveredJob, requireJobPayloadString } from "@/jobs";

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

/**
 * Finishes database operations whose interrupted jobs have no attempts left.
 *
 * @param database - Database containing the operation and its job.
 * @param job - Recovered job, including its target payload and queue outcome.
 * @param reason - Optional failure reason recorded by the worker; defaults to an interruption message.
 * @throws {Error} When a database job has no target id.
 */
export function recoverDatabaseJob(
  database: Database,
  job: RecoveredJob,
  reason: string = job.reason ?? INTERRUPTION_MESSAGE,
): void {
  if (job.outcome !== "failed") {
    return;
  }
  if (job.kind === "database_provision") {
    recoverProvision(database, requireJobPayloadString(job, "databaseId"), reason);
    return;
  }
  if (job.kind === "database_delete") {
    recoverDelete(database, requireJobPayloadString(job, "databaseId"), reason);
    return;
  }
  if (job.kind === "database_backup") {
    recoverBackup(database, requireJobPayloadString(job, "backupId"), reason);
    return;
  }
  if (job.kind === "database_restore") {
    recoverRestore(database, requireJobPayloadString(job, "backupId"), reason);
  }
}

/**
 * Checks whether a failed database job left its database or backup in a transient state.
 *
 * @param database - Database.
 * @param job - Failed job.
 * @returns True when the resource is still provisioning, deleting, queued/running backup or restoring.
 */
export function isDatabaseJobStranded(
  database: Database,
  job: Pick<Job, "id" | "kind" | "payload">,
): boolean {
  if (job.kind === "database_provision" || job.kind === "database_delete") {
    const databaseId = job.payload["databaseId"];
    if (typeof databaseId !== "string" || databaseId.trim() === "") {
      return false;
    }
    const record = findDatabaseRecord(database, databaseId);
    if (job.kind === "database_provision") {
      return record?.status === "provisioning";
    }
    return record?.deletionRequestedAt != null;
  }
  if (job.kind === "database_backup" || job.kind === "database_restore") {
    const backupId = job.payload["backupId"];
    if (typeof backupId !== "string" || backupId.trim() === "") {
      return false;
    }
    const backup = findDatabaseBackup(database, backupId);
    if (job.kind === "database_backup") {
      return backup?.status === "queued" || backup?.status === "running";
    }
    return (
      backup != null && findDatabaseRecord(database, backup.databaseId)?.status === "restoring"
    );
  }
  return false;
}

function recoverProvision(database: Database, id: string, reason: string): void {
  const record = findDatabaseRecord(database, id);
  if (
    record != null &&
    getProjectDatabase(database, record.projectId, id).status === "provisioning"
  ) {
    markDatabaseFailed(database, id, reason);
  }
}

function recoverDelete(database: Database, id: string, reason: string): void {
  const record = findDatabaseRecord(database, id);
  if (record?.deletionRequestedAt != null) {
    failDatabaseDeletion(database, id, reason);
  }
}

function recoverBackup(database: Database, id: string, reason: string): void {
  const backup = findDatabaseBackup(database, id);
  if (backup?.status === "running" || backup?.status === "queued") {
    markBackupFailed(database, id, reason);
  }
}

function recoverRestore(database: Database, id: string, reason: string): void {
  const backup = findDatabaseBackup(database, id);
  if (
    backup != null &&
    getProjectDatabase(database, backup.projectId, backup.databaseId).status === "restoring"
  ) {
    finishBackupRestore(database, backup, reason);
  }
}
