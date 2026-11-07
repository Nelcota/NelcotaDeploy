import type { Logger } from "pino";

import {
  acquireBackupMemory,
  MAX_BACKUP_BYTES,
  MAX_ENCRYPTED_BACKUP_BYTES,
  type ObjectStore,
} from "@/backups";
import {
  type DatabaseBackupRecord,
  databaseBackupKey,
  databaseBackupsPrefix,
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
import { backupStorage, type BackupStorage } from "./database-backup-storage";
import {
  type DatabaseOperation,
  assertDatabaseOperationActive,
  recordDatabaseOperationOutcome,
} from "./database-operation";

/** Dumps travel through the worker's memory to be encrypted, like the panel's own backups. */
const DUMP_TIMEOUT_IN_MS = 1_800_000;
const TRANSFER_TIMEOUT_IN_MS = 600_000;
const QUICK_COMMAND_TIMEOUT_IN_MS = 30_000;
/** Successful backups kept per database; older ones are deleted after each new one. */
const BACKUPS_KEPT_PER_DATABASE = 7;
const BACKUP_DELETE_BATCH_SIZE = 10;
/** Folder below the server's workspace where dumps wait between the container and the panel. */
const DUMP_DIRECTORY = "database-dumps";

/** What backing up or restoring needs on the database's server and in the panel. */
export type DatabaseBackupDependencies = DatabaseOperation & {
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
  const name = `${backupId}-${Bun.randomUUIDv7()}.dump`;
  return {
    container: `/tmp/nelcota-${name}`,
    hostDirectory,
    host: `${hostDirectory}/${name}`,
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
  dependencies: Pick<DatabaseBackupDependencies, "docker" | "signal">,
  containerName: string,
  command: readonly string[],
): Promise<void> {
  const result = await dependencies.docker.execInContainer(containerName, command, {
    timeoutInMs: DUMP_TIMEOUT_IN_MS,
    ...(dependencies.signal == null ? {} : { signal: dependencies.signal }),
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
    // Cleanup uses attempt-specific paths and must still run after cancellation.
    execChecked({ docker: dependencies.docker }, containerName, ["rm", "-f", paths.container]),
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
  recordDatabaseOperationOutcome(dependencies, () => markBackupRunning(database, backupId));
  const containerName = databaseContainerNameFor(record.databaseId);
  const paths = dumpPaths(dependencies, backupId);
  try {
    const sizeBytes = await storeDump(dependencies, record, paths);
    // Keep restores blocked until pruning has finished.
    assertDatabaseOperationActive(dependencies);
    await pruneBackups(dependencies, record.databaseId);
    recordDatabaseOperationOutcome(dependencies, () =>
      markBackupSucceeded(database, backupId, {
        storageKey: databaseBackupKey(dependencies.storage.prefix, record),
        sizeBytes,
      }),
    );
  } catch (error) {
    recordDatabaseOperationOutcome(dependencies, () =>
      markBackupFailed(database, backupId, errorMessage(error)),
    );
    throw error;
  } finally {
    await removeDumps(dependencies, containerName, paths);
  }
}

async function storeDump(
  dependencies: DatabaseBackupDependencies,
  record: DatabaseBackupRecord,
  paths: ReturnType<typeof dumpPaths>,
): Promise<number> {
  const { docker, runner, files, secretBox, storage } = dependencies;
  const containerName = databaseContainerNameFor(record.databaseId);
  assertDatabaseOperationActive(dependencies);
  await execChecked(dependencies, containerName, backupCommands(record).dump(paths.container));
  assertDatabaseOperationActive(dependencies);
  await runChecked(runner, ["mkdir", "-p", "--", paths.hostDirectory], "Creating the dump folder");
  await docker.copyFromContainer(containerName, paths.container, paths.host);
  using _memory = await acquireBackupMemory(dependencies.signal);
  assertDatabaseOperationActive(dependencies);
  const dump = await files.read(paths.host, {
    maxBytes: MAX_BACKUP_BYTES,
    timeoutInMs: TRANSFER_TIMEOUT_IN_MS,
  });
  const key = databaseBackupKey(storage.prefix, record);
  const encrypted = await secretBox.encryptBytes(dump, key);
  assertDatabaseOperationActive(dependencies);
  // The key is bound to the ciphertext, so a dump cannot be swapped for another database's.
  await storage.store.write(key, encrypted);
  return dump.byteLength;
}

async function pruneBackups(
  dependencies: DatabaseBackupDependencies,
  databaseId: string,
): Promise<void> {
  const expired = listExpiredDatabaseBackups(
    dependencies.database,
    databaseId,
    // The newly stored backup is still running and is not counted among these successes.
    BACKUPS_KEPT_PER_DATABASE - 1,
  );
  const results = await Promise.allSettled(
    expired.map(async (backup) => await dependencies.storage.store.delete(backup.storageKey)),
  );
  const deleted = expired.filter((_, index) => results[index]?.status === "fulfilled");
  recordDatabaseOperationOutcome(dependencies, () =>
    deleteDatabaseBackups(
      dependencies.database,
      deleted.map((backup) => backup.id),
    ),
  );
  if (deleted.length < expired.length) {
    dependencies.logger.warn({ databaseId }, "some expired database backups were not deleted");
  }
}

/**
 * Loads a stored backup into a recreated database, replacing all its current objects.
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
  assertDatabaseOperationActive(dependencies);
  const record = findDatabaseBackup(dependencies.database, backupId);
  if (record == null) {
    throw new Error(`Backup ${backupId} no longer exists`);
  }
  if (record.storageKey == null) {
    const message = `Backup ${backupId} has no stored dump`;
    recordDatabaseOperationOutcome(dependencies, () =>
      finishBackupRestore(dependencies.database, record, message),
    );
    throw new Error(message);
  }
  const containerName = databaseContainerNameFor(record.databaseId);
  const paths = dumpPaths(dependencies, backupId);
  try {
    await loadDump(dependencies, { ...record, storageKey: record.storageKey }, paths);
  } catch (error) {
    recordDatabaseOperationOutcome(dependencies, () =>
      finishBackupRestore(dependencies.database, record, errorMessage(error)),
    );
    throw error;
  } finally {
    await removeDumps(dependencies, containerName, paths);
  }
  recordDatabaseOperationOutcome(dependencies, () =>
    finishBackupRestore(dependencies.database, record, null),
  );
}

/** Removes every stored dump of one database before its metadata is deleted. */
export async function deleteStoredDatabaseBackups(
  storage: BackupStorage,
  databaseId: string,
): Promise<void> {
  const keys = await storage.store.list(databaseBackupsPrefix(storage.prefix, databaseId));
  await deleteBackupBatch(storage.store, keys);
}

async function deleteBackupBatch(store: ObjectStore, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  await Promise.all(
    keys.slice(0, BACKUP_DELETE_BATCH_SIZE).map(async (key) => await store.delete(key)),
  );
  await deleteBackupBatch(store, keys.slice(BACKUP_DELETE_BATCH_SIZE));
}

async function loadDump(
  dependencies: DatabaseBackupDependencies,
  record: DatabaseBackupRecord & { readonly storageKey: string },
  paths: ReturnType<typeof dumpPaths>,
): Promise<void> {
  const { docker, runner, files, secretBox, storage } = dependencies;
  const containerName = databaseContainerNameFor(record.databaseId);
  {
    using _memory = await acquireBackupMemory(dependencies.signal);
    assertDatabaseOperationActive(dependencies);
    const encrypted = await storage.store.read(record.storageKey, MAX_ENCRYPTED_BACKUP_BYTES);
    if (encrypted.byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
      throw new Error(`Stored dump exceeds ${MAX_ENCRYPTED_BACKUP_BYTES} bytes`);
    }
    const dump = await secretBox.decryptBytes(encrypted, record.storageKey);
    assertDatabaseOperationActive(dependencies);
    await runChecked(
      runner,
      ["mkdir", "-p", "--", paths.hostDirectory],
      "Creating the dump folder",
    );
    await files.write(paths.host, dump, TRANSFER_TIMEOUT_IN_MS);
  }
  assertDatabaseOperationActive(dependencies);
  await docker.copyToContainer(paths.host, containerName, paths.container);
  const restore = backupCommands(record).restore(paths.container);
  try {
    for (const command of restore.commands) {
      // Loading and activation must be sequential, and neither may start after lease loss.
      assertDatabaseOperationActive(dependencies);
      await execChecked(dependencies, containerName, command);
    }
  } finally {
    await cleanupRestoreDatabases(dependencies, containerName, restore.cleanup);
  }
}

async function cleanupRestoreDatabases(
  dependencies: DatabaseBackupDependencies,
  containerName: string,
  commands: readonly (readonly string[])[],
): Promise<void> {
  // Staging and retired databases belong only to this attempt; never drop the public name.
  const cleanups = await Promise.allSettled(
    commands.map(
      async (command) => await execChecked({ docker: dependencies.docker }, containerName, command),
    ),
  );
  for (const cleanup of cleanups) {
    if (cleanup.status === "rejected") {
      dependencies.logger.warn(
        { err: cleanup.reason, containerName },
        "temporary restore database left on the server",
      );
    }
  }
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
  run: Pick<DatabaseBackupDependencies, "signal" | "assertOwnership">,
): DatabaseBackupDependencies {
  const { database, hosts, secretBox, logger } = dependencies;
  // Projects with databases cannot move, so the database is on the project's current server.
  const host = hosts.hostOf(database, getProject(database, job.projectId).serverId);
  return {
    ...run,
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
 * @param run - Cancellation and ownership checks for the claimed attempt.
 * @throws {Error} When the payload has no backup id, or the backup fails.
 */
export async function runDatabaseBackupJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: Pick<DatabaseBackupDependencies, "signal" | "assertOwnership">,
): Promise<void> {
  await runDatabaseBackup(backupDependencies(dependencies, job, run), backupIdOf(job));
}

/**
 * Runs a `database_restore` job on the server of the database's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the backup.
 * @param run - Cancellation and ownership checks for the claimed attempt.
 * @throws {Error} When the payload has no backup id, or the restore fails.
 */
export async function runDatabaseRestoreJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: Pick<DatabaseBackupDependencies, "signal" | "assertOwnership">,
): Promise<void> {
  await runDatabaseRestore(backupDependencies(dependencies, job, run), backupIdOf(job));
}
