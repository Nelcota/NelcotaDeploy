import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { DatabaseEngineName } from "@/shared/schemas/database.schema";

const MAX_ERROR_LENGTH = 500;

/** What the worker needs to back up a database or restore one of its backups. */
export type DatabaseBackupRecord = {
  readonly id: string;
  readonly databaseId: string;
  readonly projectId: string;
  readonly engine: DatabaseEngineName;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly storageKey: string | null;
};

/**
 * Returns where the encrypted dump of a backup is stored, below the storage prefix.
 *
 * @param prefix - Folder of the bucket or directory, ending in "/"; empty for its root.
 * @param backup - The backup's id and its database's.
 * @returns The storage key.
 */
export function databaseBackupKey(
  prefix: string,
  backup: { readonly id: string; readonly databaseId: string },
): string {
  return `${databaseBackupsPrefix(prefix, backup.databaseId)}${backup.id}.dump.enc`;
}

/**
 * Returns the folder that holds every backup of a database.
 *
 * @param prefix - Folder of the bucket or directory, ending in "/"; empty for its root.
 * @param databaseId - Database id.
 * @returns The folder, ending in "/".
 */
export function databaseBackupsPrefix(prefix: string, databaseId: string): string {
  return `${prefix}databases/${databaseId}/`;
}

/**
 * Reads what the worker needs about a backup.
 *
 * @param database - Database.
 * @param backupId - Backup id.
 * @returns The backup, or null when it or its database no longer exists.
 */
export function findDatabaseBackup(
  database: Database,
  backupId: string,
): DatabaseBackupRecord | null {
  return (
    database
      .select({
        id: tables.databaseBackups.id,
        databaseId: tables.databaseBackups.databaseId,
        projectId: tables.projectDatabases.projectId,
        engine: tables.projectDatabases.engine,
        status: tables.databaseBackups.status,
        storageKey: tables.databaseBackups.storageKey,
      })
      .from(tables.databaseBackups)
      .innerJoin(
        tables.projectDatabases,
        eq(tables.projectDatabases.id, tables.databaseBackups.databaseId),
      )
      .where(eq(tables.databaseBackups.id, backupId))
      .get() ?? null
  );
}

/**
 * Records that the worker started a backup.
 *
 * @param database - Database.
 * @param backupId - Backup id.
 */
export function markBackupRunning(database: Database, backupId: string): void {
  database
    .update(tables.databaseBackups)
    .set({ status: "running" })
    .where(eq(tables.databaseBackups.id, backupId))
    .run();
}

/**
 * Records a stored backup.
 *
 * @param database - Database.
 * @param backupId - Backup id.
 * @param stored - Its `storageKey` and the dump's `sizeBytes` before encryption.
 */
export function markBackupSucceeded(
  database: Database,
  backupId: string,
  stored: { readonly storageKey: string; readonly sizeBytes: number },
): void {
  database
    .update(tables.databaseBackups)
    .set({ status: "succeeded", ...stored, finishedAt: new Date().toISOString() })
    .where(eq(tables.databaseBackups.id, backupId))
    .run();
}

/**
 * Records why a backup failed.
 *
 * @param database - Database.
 * @param backupId - Backup id.
 * @param reason - What went wrong, without secrets.
 */
export function markBackupFailed(database: Database, backupId: string, reason: string): void {
  database
    .update(tables.databaseBackups)
    .set({
      status: "failed",
      errorMessage: reason.slice(0, MAX_ERROR_LENGTH),
      finishedAt: new Date().toISOString(),
    })
    .where(eq(tables.databaseBackups.id, backupId))
    .run();
}

/**
 * Records the outcome of a restore on its backup and puts the database back to running: a
 * failed load preserves the original database; activation may already have committed if a
 * later step failed.
 *
 * @param database - Database.
 * @param backup - The restored backup's id and its database's.
 * @param failure - What went wrong, without secrets; null when the restore succeeded.
 */
export function finishBackupRestore(
  database: Database,
  backup: { readonly id: string; readonly databaseId: string },
  failure: string | null,
): void {
  const now = new Date().toISOString();
  database.transaction(
    (transaction) => {
      transaction
        .update(tables.databaseBackups)
        .set(
          failure == null
            ? { restoredAt: now, restoreError: null }
            : { restoreError: failure.slice(0, MAX_ERROR_LENGTH) },
        )
        .where(eq(tables.databaseBackups.id, backup.id))
        .run();
      transaction
        .update(tables.projectDatabases)
        .set({ status: "running", updatedAt: now })
        .where(eq(tables.projectDatabases.id, backup.databaseId))
        .run();
    },
    { behavior: "immediate" },
  );
}

/**
 * Lists successful backups beyond the newest ones kept, preserving pending restore targets.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 * @param kept - How many successful backups to keep, at least 1.
 * @returns The older backups with where they are stored.
 * @throws {RangeError} When `kept` is not a positive integer.
 */
export function listExpiredDatabaseBackups(
  database: Database,
  databaseId: string,
  kept: number,
): { readonly id: string; readonly storageKey: string }[] {
  if (Number.isInteger(kept) === false || kept < 1) {
    throw new RangeError(`kept must be a positive integer, received ${kept}`);
  }
  return database
    .select({
      id: tables.databaseBackups.id,
      storageKey: tables.databaseBackups.storageKey,
      restorePending: sql<boolean>`EXISTS (SELECT 1 FROM jobs WHERE kind = 'database_restore'
        AND status IN ('queued', 'running')
        AND json_extract(payload, '$.backupId') = database_backups.id)`.mapWith(Boolean),
    })
    .from(tables.databaseBackups)
    .where(
      and(
        eq(tables.databaseBackups.databaseId, databaseId),
        eq(tables.databaseBackups.status, "succeeded"),
      ),
    )
    .orderBy(desc(tables.databaseBackups.createdAt), desc(tables.databaseBackups.id))
    .all()
    .slice(kept)
    .flatMap((row) =>
      row.storageKey == null || row.restorePending
        ? []
        : [{ id: row.id, storageKey: row.storageKey }],
    );
}

/**
 * Removes backups whose stored dumps were deleted.
 *
 * @param database - Database.
 * @param backupIds - Ids of the backups.
 */
export function deleteDatabaseBackups(database: Database, backupIds: readonly string[]): void {
  if (backupIds.length === 0) {
    return;
  }
  database
    .delete(tables.databaseBackups)
    .where(inArray(tables.databaseBackups.id, [...backupIds]))
    .run();
}
