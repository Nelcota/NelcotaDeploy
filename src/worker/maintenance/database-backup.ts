import { Database as SqliteDatabase, SQLiteError } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { notify } from "@/alerts";
import { recordOffsiteStatus, uploadBackup } from "@/backups";
import { backupDatabase, listBackups } from "@/db";

import type { WorkerDependencies } from "../worker.types";

/** What backing up needs from the worker. */
type BackupDependencies = Pick<
  WorkerDependencies,
  "database" | "config" | "logger" | "secretBox" | "offsiteStore"
>;

/** A backup older than this is replaced when the worker starts. */
const MAX_BACKUP_AGE_IN_MS = 86_400_000;
const PANEL_BACKUP_UTC_HOUR = 3;
const PANEL_BACKUP_UTC_MINUTE = 30;
const PANEL_BACKUP_LOCK_FILE = ".nelcota-panel-backup-lock.sqlite";
export const PANEL_BACKUP_SCHEDULE = `${PANEL_BACKUP_UTC_MINUTE} ${PANEL_BACKUP_UTC_HOUR} * * *`;

function errorType(error: unknown): string {
  return error instanceof Error ? "Error" : typeof error;
}

/**
 * Tells whether a new backup is due: there is none yet, or the newest is a day old.
 *
 * @param newestCreatedAt - Time of the newest backup in UTC ISO 8601, or null when none exists.
 * @param now - Current time.
 * @returns True when a backup should run now.
 */
export function isBackupDue(newestCreatedAt: string | null, now: Date): boolean {
  if (newestCreatedAt == null) {
    return true;
  }
  const newest = new Date(newestCreatedAt);
  if (Number.isNaN(newest.getTime())) {
    return true;
  }
  return now.getTime() - newest.getTime() >= MAX_BACKUP_AGE_IN_MS;
}

/**
 * Sends an encrypted copy to the configured bucket and records the upload separately from retention.
 */
async function sendOffsite(
  dependencies: BackupDependencies,
  backup: { readonly path: string; readonly directory: string },
): Promise<void> {
  const { config, logger, secretBox, database, offsiteStore: store } = dependencies;
  if (store == null) {
    return;
  }

  let uploaded: Awaited<ReturnType<typeof uploadBackup>> | undefined;
  try {
    uploaded = await uploadBackup(store, secretBox, {
      path: backup.path,
      prefix: config.BACKUP_S3_PREFIX,
      kept: config.BACKUP_S3_KEPT,
    });
  } catch (error) {
    logger.error({ errorType: errorType(error) }, "off-site backup upload failed");
  }

  const at = new Date();
  try {
    const outcome = uploaded == null ? { at, failed: true as const } : { at, key: uploaded.key };
    await recordOffsiteStatus(backup.directory, outcome);
  } catch (error) {
    logger.error({ errorType: errorType(error) }, "could not record off-site backup status");
  }

  if (uploaded == null) {
    await notify(database, logger, {
      title: "Offsite backup failed",
      text: "The database backup completed on the server, but the upload to the bucket failed. Check the off-site backup status in the panel.",
    });
    return;
  }

  logger.info({ key: uploaded.key }, "database backup sent off-site");
  if (uploaded.retention != null) {
    logger.warn(
      { errorType: errorType(uploaded.retention.error) },
      "off-site backup retention failed",
    );
  }
}

async function backupWhen(
  dependencies: BackupDependencies,
  due: (newest: string | null) => boolean,
  now: Date,
): Promise<boolean> {
  if (Number.isFinite(now.getTime()) === false) {
    throw new RangeError("The panel backup time must be a valid date");
  }

  const { database, config, logger } = dependencies;
  const directory = config.BACKUP_DIR;
  if (directory == null) {
    return false;
  }

  await mkdir(directory, { recursive: true });
  // Use a separate SQLite file so an upload never holds the panel's write lock.
  // The OS releases the lock if the owning worker exits.
  using lock = new SqliteDatabase(join(directory, PANEL_BACKUP_LOCK_FILE));
  lock.run("PRAGMA busy_timeout = 0");
  try {
    lock.run("BEGIN IMMEDIATE");
  } catch (error) {
    if (error instanceof SQLiteError && error.code === "SQLITE_BUSY") {
      return false;
    }

    throw error;
  }

  const [newest] = await listBackups(directory);
  if (due(newest?.createdAt ?? null) === false) {
    return false;
  }

  const path = await backupDatabase(database, {
    directory,
    kept: config.BACKUPS_KEPT,
    now,
  });
  logger.info({ path, kept: config.BACKUPS_KEPT }, "database backed up");
  await sendOffsite(dependencies, { path, directory });
  return true;
}

/**
 * Creates at most one panel backup for the current daily UTC occurrence.
 *
 * @param dependencies - Worker dependencies.
 * @param now - The time when the schedule fired.
 * @returns Whether a backup was created.
 */
export async function runDatabaseBackup(
  dependencies: BackupDependencies,
  now: Date = new Date(),
): Promise<boolean> {
  const scheduledAt = new Date(now);
  scheduledAt.setUTCHours(PANEL_BACKUP_UTC_HOUR, PANEL_BACKUP_UTC_MINUTE, 0, 0);
  if (scheduledAt > now) {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 1);
  }

  return await backupWhen(
    dependencies,
    (newest) => newest == null || new Date(newest) < scheduledAt,
    now,
  );
}

/**
 * Backs up the database when the worker starts, if the newest backup is a day old or there
 * is none, so restarts never leave the database without a recent copy.
 *
 * @param dependencies - Worker dependencies.
 * @param now - The current time.
 * @returns Whether a backup was created.
 */
export async function backupDatabaseIfDue(
  dependencies: BackupDependencies,
  now: Date = new Date(),
): Promise<boolean> {
  return await backupWhen(dependencies, (newest) => isBackupDue(newest, now), now);
}
