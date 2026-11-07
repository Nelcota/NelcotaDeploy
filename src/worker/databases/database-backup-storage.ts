import { localObjectStore, type ObjectStore } from "@/backups";

import type { WorkerDependencies } from "../worker.types";

/** Storage for database dumps, including local backups made before a bucket was configured. */
export type BackupStorage = {
  readonly store: ObjectStore;
  /** Folder for new backups, ending in "/"; empty for the root of the store. */
  readonly prefix: string;
};

function withLocalBackups(
  bucket: ObjectStore,
  local: ObjectStore,
  bucketPrefix: string,
): ObjectStore {
  return {
    write: async (key, data) => await bucket.write(key, data),
    read: async (key, maxBytes) => {
      try {
        return await local.read(key, maxBytes);
      } catch (error) {
        // Only a missing local file belongs in the bucket. Permission and I/O errors stay visible.
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return await bucket.read(key, maxBytes);
        }
        throw error;
      }
    },
    delete: async (key) => {
      // Legacy keys are outside the bucket prefix and may be forbidden by its IAM policy.
      if (key.startsWith(bucketPrefix) === false) {
        await local.delete(key);
        return;
      }
      await Promise.all([bucket.delete(key), local.delete(key)]);
    },
    list: async (prefix) => {
      const localPrefix = prefix.startsWith(bucketPrefix)
        ? prefix.slice(bucketPrefix.length)
        : prefix;
      const [remoteKeys, localKeys] = await Promise.all([
        bucket.list(prefix),
        local.list(localPrefix),
      ]);
      return [...new Set([...remoteKeys, ...localKeys])];
    },
  };
}

/**
 * Selects storage for new backups while keeping earlier local backups readable and removable.
 *
 * @param dependencies - Worker configuration and optional bucket.
 * @returns The storage and prefix for new backups.
 * @throws {Error} When neither a bucket nor a backup directory is configured.
 */
export function backupStorage(
  dependencies: Pick<WorkerDependencies, "config" | "offsiteStore">,
): BackupStorage {
  const { config, offsiteStore } = dependencies;
  const local = config.BACKUP_DIR == null ? null : localObjectStore(config.BACKUP_DIR);
  if (offsiteStore != null) {
    return {
      store:
        local == null
          ? offsiteStore
          : withLocalBackups(offsiteStore, local, config.BACKUP_S3_PREFIX),
      prefix: config.BACKUP_S3_PREFIX,
    };
  }
  if (local == null) {
    throw new Error("Database backups need BACKUP_S3_BUCKET or BACKUP_DIR");
  }
  return { store: local, prefix: "" };
}
