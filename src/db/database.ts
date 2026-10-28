import { Database as SqliteDatabase } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { getConfig } from "@/config";

import * as schema from "./schema";

/** Drizzle database bound to the platform schema. */
export type Database = BunSQLiteDatabase<typeof schema> & { $client: SqliteDatabase };

/** Transaction handle passed to `database.transaction` callbacks. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const BUSY_TIMEOUT_IN_MS = 5000;

let sharedDatabase: Database | undefined;

/**
 * Opens a SQLite database in WAL mode with foreign keys enabled.
 *
 * @param path - File path, or ":memory:" for an in-memory database.
 * @returns A Drizzle database.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new SqliteDatabase(path, { create: true, strict: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_IN_MS}`);
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA synchronous = NORMAL");
  return drizzle({ client: sqlite, schema });
}

/**
 * Applies pending Drizzle migrations from the `drizzle/` folder.
 *
 * @param database - Database to migrate.
 */
export function migrateDatabase(database: Database): void {
  // Resolved on use: import.meta.dir is Bun-only and missing under Vite's SSR module runner.
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  migrate(database, { migrationsFolder });
}

/**
 * Opens a migrated in-memory database. Intended for tests.
 *
 * @returns A fresh, isolated database.
 */
export function openMemoryDatabase(): Database {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  return database;
}

/**
 * Returns the process-wide database configured by `DATABASE_PATH`.
 *
 * @returns The shared database connection.
 */
export function getDatabase(): Database {
  sharedDatabase ??= openDatabase(getConfig().DATABASE_PATH);
  return sharedDatabase;
}
