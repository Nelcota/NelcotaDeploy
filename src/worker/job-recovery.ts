import { eq } from "drizzle-orm";
import type { Logger } from "pino";

import {
  failDatabaseDeletion,
  findDatabaseBackup,
  findDatabaseRecord,
  finishBackupRestore,
  markBackupFailed,
  markDatabaseFailed,
} from "@/databases";
import { type Database, tables } from "@/db";
import { getDeployment, isTerminalStatus, transitionDeployment } from "@/deployments";
import type { RecoveredJob } from "@/jobs";
import { appendDeploymentLogs } from "@/logs";
import { failTaskExecutions } from "@/tasks";
import { failVolumeDeletion } from "@/volumes";

function recoverResource(database: Database, job: RecoveredJob, reason: string): void {
  if (job.outcome !== "failed") {
    return;
  }
  const databaseId = job.payload["databaseId"];
  if (typeof databaseId === "string" && databaseId !== "") {
    const record = findDatabaseRecord(database, databaseId);
    if (job.kind === "database_provision" && record?.status === "provisioning") {
      markDatabaseFailed(database, databaseId, reason);
    }
    if (job.kind === "database_delete" && record?.deletionRequestedAt != null) {
      failDatabaseDeletion(database, databaseId, reason);
    }
  }
  const volumeId = job.payload["volumeId"];
  if (job.kind === "volume_delete" && typeof volumeId === "string" && volumeId !== "") {
    const volume = database
      .select({ deletionRequestedAt: tables.projectVolumes.deletionRequestedAt })
      .from(tables.projectVolumes)
      .where(eq(tables.projectVolumes.id, volumeId))
      .get();
    if (volume?.deletionRequestedAt != null) {
      failVolumeDeletion(database, volumeId, reason);
    }
  }
  recoverBackup(database, job, reason);
}

function recoverBackup(database: Database, job: RecoveredJob, reason: string): void {
  const backupId = job.payload["backupId"];
  if (typeof backupId !== "string" || backupId === "") {
    return;
  }
  const backup = findDatabaseBackup(database, backupId);
  if (
    job.kind === "database_backup" &&
    (backup?.status === "queued" || backup?.status === "running")
  ) {
    markBackupFailed(database, backupId, reason);
  }
  if (job.kind === "database_restore") {
    if (backup != null && findDatabaseRecord(database, backup.databaseId)?.status === "restoring") {
      finishBackupRestore(database, backup, reason);
    }
  }
}

function recoverDeployment(
  database: Database,
  deploymentId: string,
  outcome: RecoveredJob["outcome"],
): void {
  const deployment = getDeployment(database, deploymentId);
  if (isTerminalStatus(deployment.status)) {
    return;
  }
  const message =
    outcome === "requeued"
      ? "The worker stopped during this deployment; it will run again"
      : "The worker stopped during this deployment";
  appendDeploymentLogs(database, deploymentId, [{ stream: "system", level: "warn", message }]);
  if (deployment.status !== "queued" || outcome === "failed") {
    transitionDeployment(database, deploymentId, {
      to: outcome === "requeued" ? "queued" : "failed",
      errorMessage: outcome === "requeued" ? null : message,
    });
  }
}

/**
 * Brings deployments and task executions of jobs interrupted by a crash back in line with
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
    const reason = job.reason ?? "The worker stopped while the operation was running";
    recoverResource(database, job, reason);
    logger.warn(
      { jobId: job.id, kind: job.kind, outcome: job.outcome },
      "recovered interrupted job",
    );
    if (job.taskExecutionId != null && job.outcome === "failed") {
      failTaskExecutions(database, [job.taskExecutionId], reason);
    }
    if (job.deploymentId != null && job.kind === "deploy") {
      recoverDeployment(database, job.deploymentId, job.outcome);
    }
  }
}
