import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Database } from "./database";

const BACKUP_PREFIX = "nelcota-";
const BACKUP_SUFFIX = ".db";
const BACKUP_NAME = /^nelcota-\d{8}T\d{6}Z\.db$/;

/** One backup file in the backup directory. */
export type BackupFile = { readonly name: string; readonly createdAt: string };

function backupName(now: Date): string {
  // 2026-10-29T03:30:00.000Z → 20261029T033000Z: sorts by time and is safe in any file system.
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
}

/**
 * Picks the backups to delete so that only the newest ones remain.
 *
 * @param names - File names in the backup directory; other files are ignored.
 * @param kept - How many backups to keep, at least 1.
 * @returns Names of the older backups to delete.
 * @throws {RangeError} When `kept` is not a positive integer.
 */
export function selectExpiredBackups(names: readonly string[], kept: number): string[] {
  if (Number.isInteger(kept) === false || kept < 1) {
    throw new RangeError(`kept must be a positive integer, received ${kept}`);
  }
  return names
    .filter((name) => BACKUP_NAME.test(name))
    .toSorted()
    .toReversed()
    .slice(kept);
}

/**
 * Lists the backups in a directory, newest first.
 *
 * @param directory - Backup directory.
 * @returns The backups; empty when the directory does not exist yet.
 */
export async function listBackups(directory: string): Promise<BackupFile[]> {
  const names = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const backups = names
    .filter((name) => BACKUP_NAME.test(name))
    .toSorted()
    .toReversed();
  return await Promise.all(
    backups.map(async (name) => ({
      name,
      createdAt: (await stat(join(directory, name))).mtime.toISOString(),
    })),
  );
}

/**
 * Writes a consistent copy of the database with `VACUUM INTO`, which works while the panel
 * runs, then deletes the backups beyond the newest `kept`.
 *
 * @param database - Database to copy.
 * @param target - Backup `directory`, how many backups are `kept` and the current time.
 * @returns Path of the new backup.
 * @throws {RangeError} When `kept` is not a positive integer.
 */
export async function backupDatabase(
  database: Database,
  target: { readonly directory: string; readonly kept: number; readonly now?: Date },
): Promise<string> {
  await mkdir(target.directory, { recursive: true });
  const path = join(target.directory, backupName(target.now ?? new Date()));
  database.$client.run("VACUUM INTO ?", [path]);
  const names = await readdir(target.directory);
  await Promise.all(
    selectExpiredBackups(names, target.kept).map(
      async (name) => await rm(join(target.directory, name), { force: true }),
    ),
  );
  return path;
}
