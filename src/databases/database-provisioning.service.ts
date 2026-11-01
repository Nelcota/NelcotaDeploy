import { eq } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";
import type { SecretBox } from "@/secrets";
import type { DatabaseEngineName } from "@/shared/schemas/database.schema";

const MAX_ERROR_LENGTH = 500;

export type DatabaseStatus = "provisioning" | "running" | "failed";

/** What the worker needs to run or remove a database. */
export type DatabaseRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly engine: DatabaseEngineName;
  readonly imageTag: string;
  readonly encryptedPassword: string;
  readonly deletionRequestedAt: string | null;
};

export function passwordContext(databaseId: string): string {
  return `database:${databaseId}:password`;
}

/**
 * Reads what the worker needs about a database.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 * @returns The database, or null when it no longer exists.
 */
export function findDatabaseRecord(database: Database, databaseId: string): DatabaseRecord | null {
  return (
    database
      .select({
        id: tables.projectDatabases.id,
        projectId: tables.projectDatabases.projectId,
        engine: tables.projectDatabases.engine,
        imageTag: tables.projectDatabases.imageTag,
        encryptedPassword: tables.projectDatabases.encryptedPassword,
        deletionRequestedAt: tables.projectDatabases.deletionRequestedAt,
      })
      .from(tables.projectDatabases)
      .where(eq(tables.projectDatabases.id, databaseId))
      .get() ?? null
  );
}

/**
 * Decrypts the password of a database.
 *
 * @param secretBox - Encryption box.
 * @param record - The database.
 * @returns The password.
 * @throws {SecretDecryptionError} When it cannot be decrypted with the current key.
 */
export async function readDatabasePassword(
  secretBox: SecretBox,
  record: Pick<DatabaseRecord, "id" | "encryptedPassword">,
): Promise<string> {
  return await secretBox.decrypt(record.encryptedPassword, passwordContext(record.id));
}

export function setStatus(
  database: Database | Transaction,
  databaseId: string,
  change: { readonly status: DatabaseStatus; readonly errorMessage: string | null },
): void {
  database
    .update(tables.projectDatabases)
    .set({ ...change, updatedAt: new Date().toISOString() })
    .where(eq(tables.projectDatabases.id, databaseId))
    .run();
}

/**
 * Records that a database accepts connections.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 */
export function markDatabaseRunning(database: Database, databaseId: string): void {
  setStatus(database, databaseId, { status: "running", errorMessage: null });
}

/**
 * Records why provisioning a database failed, so the interface can show it.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 * @param reason - What went wrong, without secrets.
 */
export function markDatabaseFailed(database: Database, databaseId: string, reason: string): void {
  setStatus(database, databaseId, {
    status: "failed",
    errorMessage: reason.slice(0, MAX_ERROR_LENGTH),
  });
}

/**
 * Removes a database once the worker deleted its container and data.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 */
export function finishDatabaseDeletion(database: Database, databaseId: string): void {
  database.delete(tables.projectDatabases).where(eq(tables.projectDatabases.id, databaseId)).run();
}

/**
 * Records why deleting a database failed, so the user can see it and try again.
 *
 * @param database - Database.
 * @param databaseId - Database id.
 * @param reason - What went wrong, without secrets.
 */
export function failDatabaseDeletion(database: Database, databaseId: string, reason: string): void {
  database
    .update(tables.projectDatabases)
    .set({
      deletionRequestedAt: null,
      errorMessage: reason.slice(0, MAX_ERROR_LENGTH),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tables.projectDatabases.id, databaseId))
    .run();
}
