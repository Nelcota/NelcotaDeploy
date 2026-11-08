import { basename } from "node:path";

import type { AppConfig } from "@/config";
import { selectExpiredBackups } from "@/db";
import type { SecretBox } from "@/secrets";

import { acquireBackupMemory, MAX_BACKUP_BYTES, MAX_ENCRYPTED_BACKUP_BYTES } from "./backup-memory";
import { readBackupBytes, readBackupFile } from "./backup-read";
import { BackupTooLargeError } from "./backup.errors";

/** The panel database is small; larger files would need streaming encryption. */
const ENCRYPTED_SUFFIX = ".enc";

/** The few bucket operations off-site backups use; tests replace the S3 client with a fake. */
export type ObjectStore = {
  readonly write: (key: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** Every key starting with the prefix. */
  readonly list: (prefix: string) => Promise<string[]>;
  readonly delete: (key: string) => Promise<void>;
  readonly read: (key: string, maxBytes?: number) => Promise<Uint8Array<ArrayBuffer>>;
};

async function listAllKeys(
  client: Bun.S3Client,
  prefix: string,
  continuationToken?: string,
): Promise<string[]> {
  const page = await client.list({
    prefix,
    ...(continuationToken == null ? {} : { continuationToken }),
  });
  const keys = (page.contents ?? []).map((object) => object.key);
  if (page.isTruncated !== true || page.nextContinuationToken == null) {
    return keys;
  }
  // Each page needs the token of the one before it.
  return [...keys, ...(await listAllKeys(client, prefix, page.nextContinuationToken))];
}

/**
 * Connects to the bucket off-site backups go to.
 *
 * @param config - Configuration with the `BACKUP_S3_*` settings.
 * @returns The bucket, or null when no bucket is configured.
 */
export function offsiteStoreFromConfig(config: AppConfig): ObjectStore | null {
  const { BACKUP_S3_BUCKET: bucket, BACKUP_S3_ACCESS_KEY_ID: accessKeyId } = config;
  const secretAccessKey = config.BACKUP_S3_SECRET_ACCESS_KEY;
  if (bucket == null || accessKeyId == null || secretAccessKey == null) {
    return null;
  }
  const client = new Bun.S3Client({
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(config.BACKUP_S3_ENDPOINT == null ? {} : { endpoint: config.BACKUP_S3_ENDPOINT }),
    ...(config.BACKUP_S3_REGION == null ? {} : { region: config.BACKUP_S3_REGION }),
  });
  return {
    write: async (key, data) => {
      await client.write(key, data);
    },
    list: async (prefix) => await listAllKeys(client, prefix),
    delete: async (key) => await client.delete(key),
    read: async (key, maxBytes = MAX_ENCRYPTED_BACKUP_BYTES) => {
      const file = client.file(key);
      const metadata = await file.stat();
      if (metadata.size > maxBytes) {
        throw new BackupTooLargeError(metadata.size, maxBytes);
      }
      return await readBackupBytes(file.stream(), maxBytes, metadata.size);
    },
  };
}

/**
 * Picks the remote backups to delete so that only the newest ones remain.
 *
 * @param keys - Keys under the prefix; anything that is not a backup is ignored.
 * @param prefix - Folder of the backups in the bucket.
 * @param kept - How many to keep, at least 1.
 * @returns Keys of the older backups.
 * @throws {RangeError} When `kept` is not a positive integer.
 */
function selectExpiredRemoteBackups(
  keys: readonly string[],
  prefix: string,
  kept: number,
): string[] {
  const names = keys
    .filter((key) => key.startsWith(prefix) && key.endsWith(ENCRYPTED_SUFFIX))
    .map((key) => key.slice(prefix.length, -ENCRYPTED_SUFFIX.length));
  return selectExpiredBackups(names, kept).map((name) => `${prefix}${name}${ENCRYPTED_SUFFIX}`);
}

/**
 * Encrypts a local backup with the panel's key and uploads it, then deletes the remote
 * backups beyond the newest `kept`.
 *
 * @param store - Bucket.
 * @param secretBox - Encrypts with NELCOTA_ENCRYPTION_KEY; the file name is bound to it.
 * @param backup - Local backup `path`, bucket `prefix` and how many remote copies are `kept`.
 * @returns The key of the uploaded backup.
 * @throws {BackupTooLargeError} When the backup is larger than 512 MiB.
 * @throws {RangeError} When `kept` is not a positive integer.
 */
export async function uploadBackup(
  store: ObjectStore,
  secretBox: SecretBox,
  backup: { readonly path: string; readonly prefix: string; readonly kept: number },
): Promise<string> {
  using _memory = await acquireBackupMemory();
  const file = Bun.file(backup.path);
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupTooLargeError(file.size, MAX_BACKUP_BYTES);
  }
  const name = basename(backup.path);
  const encrypted = await secretBox.encryptBytes(
    await readBackupFile(file, MAX_BACKUP_BYTES),
    name,
  );
  const key = `${backup.prefix}${name}${ENCRYPTED_SUFFIX}`;
  await store.write(key, encrypted);
  const expired = selectExpiredRemoteBackups(
    await store.list(backup.prefix),
    backup.prefix,
    backup.kept,
  );
  await Promise.all(expired.map(async (expiredKey) => await store.delete(expiredKey)));
  return key;
}

/**
 * Downloads and decrypts a remote backup.
 *
 * @param store - Bucket.
 * @param secretBox - Decrypts with NELCOTA_ENCRYPTION_KEY.
 * @param key - Key of the backup.
 * @returns The SQLite database bytes.
 * @throws {SecretDecryptionError} When the key changed or the file was tampered with.
 */
export async function downloadBackup(
  store: ObjectStore,
  secretBox: SecretBox,
  key: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const name = basename(key).slice(0, -ENCRYPTED_SUFFIX.length);
  const encrypted = await store.read(key, MAX_ENCRYPTED_BACKUP_BYTES);
  if (encrypted.byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
    throw new BackupTooLargeError(encrypted.byteLength, MAX_ENCRYPTED_BACKUP_BYTES);
  }
  return await secretBox.decryptBytes(encrypted, name);
}
