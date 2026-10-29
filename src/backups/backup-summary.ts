import type { AppConfig } from "@/config";
import { listBackups } from "@/db";

import { type OffsiteStatus, readOffsiteStatus } from "./offsite-status";

/** What the interface shows about database backups. */
export type BackupSummary = {
  /** Time of the newest local backup, or null when none exists. */
  readonly newestAt: string | null;
  readonly count: number;
  readonly kept: number;
  readonly offsite: {
    readonly configured: boolean;
    readonly kept: number;
    /** Outcome of the latest upload; null before the first one. */
    readonly status: OffsiteStatus | null;
  };
};

/**
 * Summarizes the local backups and the off-site copies.
 *
 * @param config - Configuration with the backup directory and bucket settings.
 * @returns The newest local backup, how many there are, and the off-site state.
 */
export async function summarizeBackups(config: AppConfig): Promise<BackupSummary> {
  const directory = config.BACKUP_DIR;
  const [backups, status] =
    directory == null
      ? [[], null]
      : await Promise.all([listBackups(directory), readOffsiteStatus(directory)]);
  return {
    newestAt: backups[0]?.createdAt ?? null,
    count: backups.length,
    kept: config.BACKUPS_KEPT,
    offsite: {
      configured: config.BACKUP_S3_BUCKET != null,
      kept: config.BACKUP_S3_KEPT,
      status,
    },
  };
}
