import type { SecretBox } from "@/secrets";

import { RestoreError } from "./backup.errors";
import { downloadBackup, type ObjectStore } from "./offsite-backup";

/** Every SQLite database file starts with these 16 bytes. */
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

/**
 * Picks the newest backup among the keys of a bucket.
 *
 * @param keys - Keys under the backup prefix.
 * @returns The newest backup key, or null when there is none.
 */
export function newestBackupKey(keys: readonly string[]): string | null {
  return (
    keys
      .filter((key) => key.endsWith(".db.enc"))
      .toSorted()
      .at(-1) ?? null
  );
}

/**
 * Downloads, decrypts and checks a remote backup, then writes it to a new file. The live
 * database is never touched: the panel is stopped and the file swapped by hand.
 *
 * @param store - Bucket.
 * @param secretBox - Decrypts with NELCOTA_ENCRYPTION_KEY.
 * @param restore - Backup `key` and the `output` path, which must not exist yet.
 * @returns How many bytes were written.
 * @throws {RestoreError} When the output exists or the backup is not a SQLite database.
 * @throws {SecretDecryptionError} When the key changed or the backup was tampered with.
 */
export async function restoreBackupTo(
  store: ObjectStore,
  secretBox: SecretBox,
  restore: { readonly key: string; readonly output: string },
): Promise<number> {
  if (await Bun.file(restore.output).exists()) {
    throw new RestoreError(`${restore.output} already exists; choose a new file`);
  }
  const bytes = await downloadBackup(store, secretBox, restore.key);
  const header = bytes.subarray(0, SQLITE_HEADER.byteLength);
  if (Buffer.compare(header, SQLITE_HEADER) !== 0) {
    throw new RestoreError(`${restore.key} is not a SQLite database`);
  }
  return await Bun.write(restore.output, bytes);
}
