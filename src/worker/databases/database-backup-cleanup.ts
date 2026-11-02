import { and, inArray, isNotNull } from "drizzle-orm";

import { databaseBackupsPrefix, listProjectDatabases } from "@/databases";
import { type Database, tables } from "@/db";

import type { BackupStorage } from "./database-backup-runner";

/**
 * Removes a project's stored database dumps before their metadata can be cascaded away.
 *
 * @param database - Database retaining the project's database ids and backup records.
 * @param projectId - Project being deleted.
 * @param storage - Configured backup storage, or null when none is configured.
 * @throws {Error} When stored backups exist without storage, or a storage operation fails.
 */
export async function deleteProjectDatabaseBackups(
  database: Database,
  projectId: string,
  storage: BackupStorage | null,
): Promise<void> {
  const databases = listProjectDatabases(database, projectId);
  if (databases.length === 0) {
    return;
  }
  if (storage == null) {
    assertNoStoredBackups(
      database,
      databases.map((item) => item.id),
    );
    return;
  }
  await Promise.all(
    databases.map(async (item) => {
      const keys = await storage.store.list(databaseBackupsPrefix(storage.prefix, item.id));
      await Promise.all(keys.map(async (key) => await storage.store.delete(key)));
    }),
  );
}

function assertNoStoredBackups(database: Database, databaseIds: readonly string[]): void {
  const stored = database
    .select({ id: tables.databaseBackups.id })
    .from(tables.databaseBackups)
    .where(
      and(
        inArray(tables.databaseBackups.databaseId, databaseIds),
        isNotNull(tables.databaseBackups.storageKey),
      ),
    )
    .limit(1)
    .get();
  if (stored != null) {
    throw new Error("Cannot delete stored database backups without backup storage");
  }
}
