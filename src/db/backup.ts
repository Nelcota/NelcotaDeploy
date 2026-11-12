import { link, mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Database } from "./database";

const OWNER_READ_WRITE = 0o600;
const BACKUP_PREFIX = "nelcota-";
const BACKUP_SUFFIX = ".db";
const BACKUP_NAME = /^nelcota-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

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

function backupCreatedAt(name: string): string | null {
  const timestamp = name.replace(BACKUP_NAME, "$1-$2-$3T$4:$5:$6.000Z");
  if (timestamp === name) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && date.toISOString() === timestamp ? timestamp : null;
}

/**
 * Identifies a panel backup by its file name and a valid UTC timestamp.
 *
 * @param name - File name without any directory prefix.
 * @returns Whether it is a panel backup name.
 */
function isPanelBackupName(name: string): boolean {
  return backupCreatedAt(name) != null;
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
  assertValidRetention(kept);
  return names.filter(isPanelBackupName).toSorted().slice(0, -kept).toReversed();
}

function assertValidRetention(kept: number): void {
  if (Number.isSafeInteger(kept) === false || kept < 1) {
    throw new RangeError(`kept must be a positive safe integer, received ${kept}`);
  }
}

/**
 * Lists the backups by their snapshot timestamps, newest first.
 *
 * @param directory - Backup directory.
 * @returns The backups; empty when the directory does not exist yet.
 */
export async function listBackups(directory: string): Promise<BackupFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile())
    .flatMap(({ name }) => {
      const createdAt = backupCreatedAt(name);
      return createdAt == null ? [] : [{ name, createdAt }];
    })
    .toSorted((first, second) => second.name.localeCompare(first.name));
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
  assertValidRetention(target.kept);
  const path = join(target.directory, backupName(target.now ?? new Date()));
  await mkdir(target.directory, { recursive: true });
  await publishBackup(database, path);
  const entries = await readdir(target.directory, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  await Promise.all(
    selectExpiredBackups(names, target.kept).map(
      async (name) => await rm(join(target.directory, name), { force: true }),
    ),
  );
  return path;
}

async function publishBackup(database: Database, path: string): Promise<void> {
  const temporaryPath = `${path}.${Bun.randomUUIDv7()}.tmp`;
  const reservation = await open(temporaryPath, "wx", OWNER_READ_WRITE);
  await using _temporary = {
    [Symbol.asyncDispose]: async () => await rm(temporaryPath, { force: true }),
  };
  await reservation.close();
  database.$client.run("VACUUM INTO ?", [temporaryPath]);
  // A same-filesystem hard link publishes the complete file and fails if the name was taken.
  await link(temporaryPath, path);
}
