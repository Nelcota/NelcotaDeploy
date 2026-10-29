import { backupDatabase, listBackups } from "@/db";

import type { WorkerDependencies } from "../worker.types";

/** A backup older than this is replaced when the worker starts. */
const MAX_BACKUP_AGE_IN_MS = 86_400_000;

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
 * Backs up the database and keeps only the newest copies.
 *
 * @param dependencies - Worker dependencies; nothing happens without a backup directory.
 */
export async function runDatabaseBackup(dependencies: WorkerDependencies): Promise<void> {
  const { database, config, logger } = dependencies;
  if (config.BACKUP_DIR == null) {
    return;
  }
  const path = await backupDatabase(database, {
    directory: config.BACKUP_DIR,
    kept: config.BACKUPS_KEPT,
  });
  logger.info({ path, kept: config.BACKUPS_KEPT }, "database backed up");
}

/**
 * Backs up the database when the worker starts, if the newest backup is a day old or there
 * is none, so restarts never leave the database without a recent copy.
 *
 * @param dependencies - Worker dependencies.
 */
export async function backupDatabaseIfDue(dependencies: WorkerDependencies): Promise<void> {
  const directory = dependencies.config.BACKUP_DIR;
  if (directory == null) {
    return;
  }
  const [newest] = await listBackups(directory);
  if (isBackupDue(newest?.createdAt ?? null, new Date())) {
    await runDatabaseBackup(dependencies);
  }
}
