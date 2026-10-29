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
 * Sends an encrypted copy of a local backup to the configured bucket and records the outcome.
 * A failure is recorded and alerted, never thrown: the local backup already exists.
 */
async function sendOffsite(
  dependencies: BackupDependencies,
  backup: { readonly path: string; readonly directory: string },
): Promise<void> {
  const { config, logger, secretBox, database, offsiteStore: store } = dependencies;
  if (store == null) {
    return;
  }
  try {
    const key = await uploadBackup(store, secretBox, {
      path: backup.path,
      prefix: config.BACKUP_S3_PREFIX,
      kept: config.BACKUP_S3_KEPT,
    });
    await recordOffsiteStatus(backup.directory, { at: new Date(), key });
    logger.info({ key }, "database backup sent off-site");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordOffsiteStatus(backup.directory, { at: new Date(), error: message });
    logger.error({ err: error }, "off-site backup failed");
    await notify(database, logger, {
      title: "Backup externo falhou",
      text: "O backup do banco foi feito no servidor, mas não chegou ao bucket. Veja Configurações → Sistema.",
    });
  }
}

/**
 * Backs up the database, keeps only the newest copies and sends one off-site when a bucket
 * is configured.
 *
 * @param dependencies - Worker dependencies; nothing happens without a backup directory.
 */
export async function runDatabaseBackup(dependencies: BackupDependencies): Promise<void> {
  const { database, config, logger } = dependencies;
  if (config.BACKUP_DIR == null) {
    return;
  }
  const path = await backupDatabase(database, {
    directory: config.BACKUP_DIR,
    kept: config.BACKUPS_KEPT,
  });
  logger.info({ path, kept: config.BACKUPS_KEPT }, "database backed up");
  await sendOffsite(dependencies, { path, directory: config.BACKUP_DIR });
}

/**
 * Backs up the database when the worker starts, if the newest backup is a day old or there
 * is none, so restarts never leave the database without a recent copy.
 *
 * @param dependencies - Worker dependencies.
 */
export async function backupDatabaseIfDue(dependencies: BackupDependencies): Promise<void> {
  const directory = dependencies.config.BACKUP_DIR;
  if (directory == null) {
    return;
  }
  const [newest] = await listBackups(directory);
  if (isBackupDue(newest?.createdAt ?? null, new Date())) {
    await runDatabaseBackup(dependencies);
  }
}
