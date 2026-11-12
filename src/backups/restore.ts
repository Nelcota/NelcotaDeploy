import { Database as Sqlite } from "bun:sqlite";
import { open } from "node:fs/promises";

import { isPanelBackupName } from "@/db";
import type { SecretBox } from "@/secrets";
import { publishPrivateFile } from "@/shared/private-file";

import { acquireBackupMemory } from "./backup-memory";
import { RestoreError } from "./backup.errors";
import { downloadBackup, type ObjectStore } from "./offsite-backup";

/** Every SQLite database file starts with these 16 bytes. */
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");
const ENCRYPTED_SUFFIX = ".enc";

/**
 * Picks the newest backup among the keys of a bucket.
 *
 * @param keys - Keys under the backup prefix.
 * @param prefix - Folder that directly contains panel backups.
 * @returns The newest backup key, or null when there is none.
 */
export function newestBackupKey(keys: readonly string[], prefix: string): string | null {
  let newest: string | null = null;
  for (const key of keys) {
    if (key.startsWith(prefix) === false || key.endsWith(ENCRYPTED_SUFFIX) === false) {
      continue;
    }

    const name = key.slice(prefix.length, -ENCRYPTED_SUFFIX.length);
    if (isPanelBackupName(name) && (newest == null || key > newest)) {
      newest = key;
    }
  }

  return newest;
}

function assertSqliteIntegrity(path: string, key: string): void {
  const message = `${key} failed the SQLite integrity check`;
  let passed: boolean;
  try {
    using database = new Sqlite(path, { readonly: true });
    const result = database.query<{ quick_check: string }, []>("PRAGMA quick_check(1)").get();
    passed = result?.quick_check === "ok";
  } catch {
    throw new RestoreError(message);
  }

  if (passed === false) {
    throw new RestoreError(message);
  }
}

/**
 * Downloads, decrypts and checks a remote backup, then writes it to a new file. The live
 * database is never touched: the panel is stopped and the file swapped by hand.
 *
 * @param store - Bucket.
 * @param secretBox - Decrypts with NELCOTA_ENCRYPTION_KEY.
 * @param restore - Backup `key` and the `output` path, which must not exist yet.
 * @returns How many bytes were written.
 * @throws {RestoreError} When the output exists or the backup fails SQLite validation.
 * @throws {SecretDecryptionError} When the key changed or the backup was tampered with.
 */
export async function restoreBackupTo(
  store: ObjectStore,
  secretBox: SecretBox,
  restore: { readonly key: string; readonly output: string },
): Promise<number> {
  using _memory = await acquireBackupMemory();
  if (await Bun.file(restore.output).exists()) {
    throw new RestoreError(`${restore.output} already exists; choose a new file`);
  }
  const bytes = await downloadBackup(store, secretBox, restore.key);
  const header = bytes.subarray(0, SQLITE_HEADER.byteLength);
  if (Buffer.compare(header, SQLITE_HEADER) !== 0) {
    throw new RestoreError(`${restore.key} is not a SQLite database`);
  }

  try {
    await publishPrivateFile(restore.output, async (temporaryPath) => {
      {
        await using file = await open(temporaryPath, "r+");
        await file.writeFile(bytes);
        await file.sync();
      }

      assertSqliteIntegrity(temporaryPath, restore.key);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new RestoreError(`${restore.output} already exists; choose a new file`);
    }

    throw error;
  }

  return bytes.byteLength;
}
