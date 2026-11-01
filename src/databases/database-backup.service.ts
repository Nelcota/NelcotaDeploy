import { and, desc, eq, inArray, max } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";

import { databaseEngine } from "./database-engines";
import {
  DatabaseBackupInProgressError,
  DatabaseBackupNotFoundError,
  DatabaseBackupUnsupportedError,
  DatabaseBeingDeletedError,
  DatabaseNotRunningError,
} from "./database.errors";
import { getProjectDatabase } from "./database.service";

/** A scheduled backup runs when the newest one of the database is older than this. */
const SCHEDULED_BACKUP_INTERVAL_IN_MS = 86_400_000;
/** Most backups listed for a database; older ones are pruned by the worker anyway. */
const MAX_LISTED_BACKUPS = 50;

/** A backup of a database as shown to users. */
type DatabaseBackupView = {
  readonly id: string;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly trigger: "manual" | "scheduled";
  /** Size of the dump before encryption, in bytes; null until the backup succeeds. */
  readonly sizeBytes: number | null;
  readonly errorMessage: string | null;
  readonly restoredAt: string | null;
  readonly restoreError: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

type BackupTarget = {
  readonly projectId: string;
  readonly databaseId: string;
  readonly actor: Actor;
};

/** Refuses a database that cannot be backed up or restored now. */
function assertBackupPossible(
  database: Database | Transaction,
  projectId: string,
  databaseId: string,
): void {
  const found = getProjectDatabase(database, projectId, databaseId);
  if (found.deletionRequestedAt != null) {
    throw new DatabaseBeingDeletedError(databaseId);
  }
  if (databaseEngine(found.engine).backup == null) {
    throw new DatabaseBackupUnsupportedError(found.engine);
  }
  if (found.status !== "running") {
    throw new DatabaseNotRunningError(databaseId, found.status);
  }
}

/**
 * Lists the backups of a database, newest first.
 *
 * @param database - Database.
 * @param target - Owning project and database.
 * @returns Up to 50 backups.
 * @throws {DatabaseNotFoundError} When the database is not one of the project's.
 */
export function listDatabaseBackups(
  database: Database,
  target: { readonly projectId: string; readonly databaseId: string },
): DatabaseBackupView[] {
  getProjectDatabase(database, target.projectId, target.databaseId);
  return database
    .select({
      id: tables.databaseBackups.id,
      status: tables.databaseBackups.status,
      trigger: tables.databaseBackups.trigger,
      sizeBytes: tables.databaseBackups.sizeBytes,
      errorMessage: tables.databaseBackups.errorMessage,
      restoredAt: tables.databaseBackups.restoredAt,
      restoreError: tables.databaseBackups.restoreError,
      createdAt: tables.databaseBackups.createdAt,
      finishedAt: tables.databaseBackups.finishedAt,
    })
    .from(tables.databaseBackups)
    .where(eq(tables.databaseBackups.databaseId, target.databaseId))
    .orderBy(desc(tables.databaseBackups.createdAt))
    .limit(MAX_LISTED_BACKUPS)
    .all();
}

function insertBackup(
  transaction: Transaction,
  request: {
    readonly projectId: string;
    readonly databaseId: string;
    readonly trigger: "manual" | "scheduled";
    readonly now: Date;
  },
): string {
  const id = Bun.randomUUIDv7();
  transaction
    .insert(tables.databaseBackups)
    .values({
      id,
      databaseId: request.databaseId,
      status: "queued",
      trigger: request.trigger,
      createdAt: request.now.toISOString(),
    })
    .run();
  enqueueJob(
    transaction,
    {
      kind: "database_backup",
      projectId: request.projectId,
      payload: { backupId: id },
      dedupeKey: `database-backup:${id}`,
    },
    request.now,
  );
  return id;
}

/**
 * Queues a backup of a database now.
 *
 * @param database - Database.
 * @param target - Project, database and who asks.
 * @returns The id of the new backup.
 * @throws {DatabaseNotFoundError} When the database is not one of the project's.
 * @throws {DatabaseBeingDeletedError} When it is being deleted.
 * @throws {DatabaseBackupUnsupportedError} When its engine is not backed up.
 * @throws {DatabaseNotRunningError} When it is not running.
 * @throws {DatabaseBackupInProgressError} When a backup of it is already queued or running.
 */
export function requestDatabaseBackup(database: Database, target: BackupTarget): string {
  const { projectId, databaseId, actor } = target;
  return database.transaction((transaction) => {
    assertBackupPossible(transaction, projectId, databaseId);
    const pending = transaction
      .select({ id: tables.databaseBackups.id })
      .from(tables.databaseBackups)
      .where(
        and(
          eq(tables.databaseBackups.databaseId, databaseId),
          inArray(tables.databaseBackups.status, ["queued", "running"]),
        ),
      )
      .get();
    if (pending != null) {
      throw new DatabaseBackupInProgressError(databaseId);
    }
    const backupId = insertBackup(transaction, {
      projectId,
      databaseId,
      trigger: "manual",
      now: new Date(),
    });
    recordAuditEvent(transaction, {
      actor,
      action: "database.backup",
      targetType: "database",
      targetId: databaseId,
      metadata: { projectId, backupId },
    });
    return backupId;
  });
}

/**
 * Queues the restore of a backup over its database's current data.
 *
 * @param database - Database.
 * @param target - Project, database, the `backupId` to restore and who asks.
 * @throws {DatabaseNotFoundError} When the database is not one of the project's.
 * @throws {DatabaseBeingDeletedError} When it is being deleted.
 * @throws {DatabaseBackupUnsupportedError} When its engine is not backed up.
 * @throws {DatabaseNotRunningError} When it is not running, such as during another restore.
 * @throws {DatabaseBackupNotFoundError} When the backup is not a successful one of the database.
 */
export function requestDatabaseRestore(
  database: Database,
  target: BackupTarget & { readonly backupId: string },
): void {
  const { projectId, databaseId, backupId, actor } = target;
  database.transaction((transaction) => {
    assertBackupPossible(transaction, projectId, databaseId);
    const backup = transaction
      .select({ status: tables.databaseBackups.status })
      .from(tables.databaseBackups)
      .where(
        and(
          eq(tables.databaseBackups.id, backupId),
          eq(tables.databaseBackups.databaseId, databaseId),
        ),
      )
      .get();
    if (backup?.status !== "succeeded") {
      throw new DatabaseBackupNotFoundError(backupId);
    }
    transaction
      .update(tables.projectDatabases)
      .set({ status: "restoring", updatedAt: new Date().toISOString() })
      .where(eq(tables.projectDatabases.id, databaseId))
      .run();
    enqueueJob(transaction, {
      kind: "database_restore",
      projectId,
      payload: { backupId },
      dedupeKey: `database-restore:${databaseId}`,
    });
    recordAuditEvent(transaction, {
      actor,
      action: "database.restore",
      targetType: "database",
      targetId: databaseId,
      metadata: { projectId, backupId },
    });
  });
}

/**
 * Queues a scheduled backup for every running database that can be backed up and has no
 * backup from the last day, failed ones included, so a broken database is retried daily.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns How many backups were queued.
 */
export function queueDueDatabaseBackups(database: Database, now: Date): number {
  const candidates = database
    .select({
      id: tables.projectDatabases.id,
      projectId: tables.projectDatabases.projectId,
      engine: tables.projectDatabases.engine,
    })
    .from(tables.projectDatabases)
    .where(eq(tables.projectDatabases.status, "running"))
    .all()
    .filter((candidate) => databaseEngine(candidate.engine).backup != null);
  if (candidates.length === 0) {
    return 0;
  }
  const newest = new Map(
    database
      .select({
        databaseId: tables.databaseBackups.databaseId,
        createdAt: max(tables.databaseBackups.createdAt),
      })
      .from(tables.databaseBackups)
      .where(
        inArray(
          tables.databaseBackups.databaseId,
          candidates.map((candidate) => candidate.id),
        ),
      )
      .groupBy(tables.databaseBackups.databaseId)
      .all()
      .map((row) => [row.databaseId, row.createdAt]),
  );
  const due = candidates.filter((candidate) =>
    isDatabaseBackupDue(newest.get(candidate.id) ?? null, now),
  );
  database.transaction((transaction) => {
    for (const candidate of due) {
      insertBackup(transaction, {
        projectId: candidate.projectId,
        databaseId: candidate.id,
        trigger: "scheduled",
        now,
      });
    }
  });
  return due.length;
}

/**
 * Tells whether a database needs a scheduled backup.
 *
 * @param newestCreatedAt - When its newest backup was created, in UTC ISO 8601; null for none.
 * @param now - Current time.
 * @returns True when there is no backup or the newest is a day old.
 */
export function isDatabaseBackupDue(newestCreatedAt: string | null, now: Date): boolean {
  if (newestCreatedAt == null) {
    return true;
  }
  const newest = new Date(newestCreatedAt);
  if (Number.isNaN(newest.getTime())) {
    return true;
  }
  return now.getTime() - newest.getTime() >= SCHEDULED_BACKUP_INTERVAL_IN_MS;
}
