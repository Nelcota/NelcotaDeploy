import type { Logger } from "pino";

import { localObjectStore, type ObjectStore } from "@/backups";
import {
  type DatabaseBackupRecord,
  databaseBackupKey,
  databaseEngine,
  deleteDatabaseBackups,
  findDatabaseBackup,
  finishBackupRestore,
  listExpiredDatabaseBackups,
  markBackupFailed,
  markBackupRunning,
  markBackupSucceeded,
} from "@/databases";
import type { Database } from "@/db";
import { databaseContainerNameFor, type DockerEngine } from "@/docker";
import type { Job } from "@/jobs";
import { type CommandRunner, failureReason } from "@/process";
import { getProject } from "@/projects";
import type { SecretBox } from "@/secrets";

import type { ServerFiles } from "../server-host";
import type { WorkerDependencies } from "../worker.types";

/** Dumps travel through the worker's memory to be encrypted, like the panel's own backups. */
const MAX_DUMP_BYTES = 536_870_912; // 512 MiB
const DUMP_TIMEOUT_IN_MS = 1_800_000;
const TRANSFER_TIMEOUT_IN_MS = 600_000;
const QUICK_COMMAND_TIMEOUT_IN_MS = 30_000;
/** Successful backups kept per database; older ones are deleted after each new one. */
const BACKUPS_KEPT_PER_DATABASE = 7;
/** Folder below the server's workspace where dumps wait between the container and the panel. */
const DUMP_DIRECTORY = "database-dumps";

/** Where backups are stored: the bucket, or the panel's backup directory without one. */
export type BackupStorage = {
  readonly store: ObjectStore;
  /** Folder of the backups, ending in "/"; empty for the root of the store. */
  readonly prefix: string;
};

/** What backing up or restoring needs on the database's server and in the panel. */
export type DatabaseBackupDependencies = {
  readonly database: Database;
  readonly docker: DockerEngine;
  readonly runner: CommandRunner;
  readonly files: ServerFiles;
  readonly workspaceDir: string;
  readonly secretBox: SecretBox;
  readonly storage: BackupStorage;
  readonly logger: Pick<Logger, "warn">;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Paths of one dump: inside the database container and in the server's workspace. */
function dumpPaths(dependencies: DatabaseBackupDependencies, backupId: string) {
  const hostDirectory = `${dependencies.workspaceDir}/${DUMP_DIRECTORY}`;
  return {
    container: `/tmp/nelcota-${backupId}.dump`,
    hostDirectory,
    host: `${hostDirectory}/${backupId}.dump`,
  };
}

async function runChecked(
  runner: CommandRunner,
  command: readonly string[],
  what: string,
): Promise<void> {
  const result = await runner(command, { timeoutInMs: QUICK_COMMAND_TIMEOUT_IN_MS });
  if (result.exitCode !== 0) {
    throw new Error(`${what} failed: ${failureReason(result)}`);
  }
}

async function execChecked(
  docker: DockerEngine,
  containerName: string,
  command: readonly string[],
): Promise<void> {
  const result = await docker.execInContainer(containerName, command, {
    timeoutInMs: DUMP_TIMEOUT_IN_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0] ?? "command"} failed: ${failureReason(result)}`);
  }
}

/** Removes the dump from the container and the server; a leftover only wastes disk space. */
async function removeDumps(
  dependencies: DatabaseBackupDependencies,
  containerName: string,
  paths: ReturnType<typeof dumpPaths>,
): Promise<void> {
  const results = await Promise.allSettled([
    execChecked(dependencies.docker, containerName, ["rm", "-f", paths.container]),
    runChecked(dependencies.runner, ["rm", "-f", "--", paths.host], "Removing the dump"),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      dependencies.logger.warn({ err: result.reason, containerName }, "dump left on the server");
    }
  }
}

function backupCommands(record: DatabaseBackupRecord) {
  const commands = databaseEngine(record.engine).backup;
  if (commands == null) {
    throw new Error(`Backups are not available for ${record.engine} databases`);
  }
  return commands;
}

/**
 * Dumps a database inside its container, encrypts the dump and stores it, then deletes the
 * backups beyond the newest seven. The outcome is recorded on the backup.
 *
 * @param dependencies - Database, the database server's Docker, runner and files, encryption,
 *   storage and logger.
 * @param backupId - Backup to run.
 * @throws {Error} When any step fails; the reason is stored on the backup first.
 */
export async function runDatabaseBackup(
  dependencies: DatabaseBackupDependencies,
  backupId: string,
): Promise<void> {
  const { database } = dependencies;
  const record = findDatabaseBackup(database, backupId);
  // Deleted with its database while waiting, or already finished before a worker restart.
  if (record == null || record.status === "succeeded" || record.status === "failed") {
    return;
  }
  markBackupRunning(database, backupId);
  const containerName = databaseContainerNameFor(record.databaseId);
  const paths = dumpPaths(dependencies, backupId);
  try {
    const sizeBytes = await storeDump(dependencies, record, paths);
    markBackupSucceeded(database, backupId, {
      storageKey: databaseBackupKey(dependencies.storage.prefix, record),
      sizeBytes,
    });
  } catch (error) {
    markBackupFailed(database, backupId, errorMessage(error));
    throw error;
  } finally {
    await removeDumps(dependencies, containerName, paths);
  }
  await pruneBackups(dependencies, record.databaseId);
}

async function storeDump(
  dependencies: DatabaseBackupDependencies,
  record: DatabaseBackupRecord,
  paths: ReturnType<typeof dumpPaths>,
): Promise<number> {
  const { docker, runner, files, secretBox, storage } = dependencies;
  const containerName = databaseContainerNameFor(record.databaseId);
  await execChecked(docker, containerName, backupCommands(record).dump(paths.container));
  await runChecked(runner, ["mkdir", "-p", "--", paths.hostDirectory], "Creating the dump folder");
  await docker.copyFromContainer(containerName, paths.container, paths.host);
  const dump = await files.read(paths.host, {
    maxBytes: MAX_DUMP_BYTES,
    timeoutInMs: TRANSFER_TIMEOUT_IN_MS,
  });
  const key = databaseBackupKey(storage.prefix, record);
  // The key is bound to the ciphertext, so a dump cannot be swapped for another database's.
  await storage.store.write(key, await secretBox.encryptBytes(dump, key));
  return dump.byteLength;
}

async function pruneBackups(
  dependencies: DatabaseBackupDependencies,
  databaseId: string,
): Promise<void> {
  const expired = listExpiredDatabaseBackups(
    dependencies.database,
    databaseId,
    BACKUPS_KEPT_PER_DATABASE,
  );
  const results = await Promise.allSettled(
    expired.map(async (backup) => await dependencies.storage.store.delete(backup.storageKey)),
  );
  const deleted = expired.filter((_, index) => results[index]?.status === "fulfilled");
  deleteDatabaseBackups(
    dependencies.database,
    deleted.map((backup) => backup.id),
  );
  if (deleted.length < expired.length) {
    dependencies.logger.warn({ databaseId }, "some expired database backups were not deleted");
  }
}

/**
 * Loads a stored backup back into its database, replacing the objects the dump contains.
 * The outcome is recorded on the backup and the database is running again either way.
 *
 * @param dependencies - Database, the database server's Docker, runner and files, encryption,
 *   storage and logger.
 * @param backupId - Backup to restore.
 * @throws {Error} When any step fails; the reason is stored on the backup first.
 */
export async function runDatabaseRestore(
  dependencies: DatabaseBackupDependencies,
  backupId: string,
): Promise<void> {
  const record = findDatabaseBackup(dependencies.database, backupId);
  if (record?.storageKey == null) {
    return;
  }
  const containerName = databaseContainerNameFor(record.databaseId);
  const paths = dumpPaths(dependencies, backupId);
  try {
    await loadDump(dependencies, { ...record, storageKey: record.storageKey }, paths);
  } catch (error) {
    finishBackupRestore(dependencies.database, record, errorMessage(error));
    throw error;
  } finally {
    await removeDumps(dependencies, containerName, paths);
  }
  finishBackupRestore(dependencies.database, record, null);
}

async function loadDump(
  dependencies: DatabaseBackupDependencies,
  record: DatabaseBackupRecord & { readonly storageKey: string },
  paths: ReturnType<typeof dumpPaths>,
): Promise<void> {
  const { docker, runner, files, secretBox, storage } = dependencies;
  const containerName = databaseContainerNameFor(record.databaseId);
  const encrypted = await storage.store.read(record.storageKey);
  const dump = await secretBox.decryptBytes(encrypted, record.storageKey);
  await runChecked(runner, ["mkdir", "-p", "--", paths.hostDirectory], "Creating the dump folder");
  await files.write(paths.host, dump, TRANSFER_TIMEOUT_IN_MS);
  await docker.copyToContainer(paths.host, containerName, paths.container);
  await execChecked(docker, containerName, backupCommands(record).restore(paths.container));
}

/**
 * Picks where database backups go: the configured bucket, below its prefix, or a folder of the
 * panel's backup directory.
 *
 * @param dependencies - Worker configuration and bucket.
 * @returns The storage.
 * @throws {Error} When there is neither a bucket nor a backup directory.
 */
export function backupStorage(
  dependencies: Pick<WorkerDependencies, "config" | "offsiteStore">,
): BackupStorage {
  const { config, offsiteStore } = dependencies;
  if (offsiteStore != null) {
    return { store: offsiteStore, prefix: config.BACKUP_S3_PREFIX };
  }
  if (config.BACKUP_DIR == null) {
    throw new Error("Database backups need BACKUP_S3_BUCKET or BACKUP_DIR");
  }
  return { store: localObjectStore(config.BACKUP_DIR), prefix: "" };
}

function backupIdOf(job: Job): string {
  const backupId = job.payload["backupId"];
  if (typeof backupId !== "string" || backupId === "") {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its backup id`);
  }
  return backupId;
}

function backupDependencies(
  dependencies: WorkerDependencies,
  job: Job,
): DatabaseBackupDependencies {
  const { database, hosts, secretBox, logger } = dependencies;
  // Projects with databases cannot move, so the database is on the project's current server.
  const host = hosts.hostOf(database, getProject(database, job.projectId).serverId);
  return {
    database,
    docker: host.docker,
    runner: host.runner,
    files: host.files,
    workspaceDir: host.workspaceDir,
    secretBox,
    storage: backupStorage(dependencies),
    logger,
  };
}

/**
 * Runs a `database_backup` job on the server of the database's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the backup.
 * @throws {Error} When the payload has no backup id, or the backup fails.
 */
export async function runDatabaseBackupJob(
  dependencies: WorkerDependencies,
  job: Job,
): Promise<void> {
  await runDatabaseBackup(backupDependencies(dependencies, job), backupIdOf(job));
}

/**
 * Runs a `database_restore` job on the server of the database's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the backup.
 * @throws {Error} When the payload has no backup id, or the restore fails.
 */
export async function runDatabaseRestoreJob(
  dependencies: WorkerDependencies,
  job: Job,
): Promise<void> {
  await runDatabaseRestore(backupDependencies(dependencies, job), backupIdOf(job));
}
