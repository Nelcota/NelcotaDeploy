import {
  type DatabaseRecord,
  databaseEngine,
  failDatabaseDeletion,
  findDatabaseRecord,
  finishDatabaseDeletion,
  markDatabaseFailed,
  markDatabaseRunning,
  readDatabasePassword,
} from "@/databases";
import type { Database } from "@/db";
import {
  databaseContainerNameFor,
  databaseVolumeNameFor,
  type DockerEngine,
  LABELS,
} from "@/docker";
import type { Job } from "@/jobs";
import { getProject } from "@/projects";
import type { SecretBox } from "@/secrets";

import type { WorkerDependencies } from "../worker.types";

const READINESS_COMMAND_TIMEOUT_IN_MS = 10_000;
const MS_PER_SECOND = 1000;

/** How long to wait for a new database to accept connections, and how often to ask. */
type Readiness = { readonly timeoutInMs: number; readonly intervalInMs: number };

// The first start of PostgreSQL creates its cluster, which takes a while on small servers.
const DEFAULT_READINESS: Readiness = { timeoutInMs: 120_000, intervalInMs: 1000 };

/** What running or removing a database needs on its project's server. */
export type DatabaseRunDependencies = {
  readonly database: Database;
  readonly docker: DockerEngine;
  readonly secretBox: SecretBox;
  /** Platform network the applications of the server are on. */
  readonly network: string;
  readonly readiness?: Readiness;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a database container, unless it already runs, and waits until it accepts connections.
 * The outcome is recorded on the database.
 *
 * @param dependencies - Database, Docker of the project's server, encryption and network.
 * @param databaseId - Database to provision.
 * @param signal - Aborts the wait when the worker shuts down.
 * @throws {Error} When the container cannot start or never accepts connections; the reason is
 *   stored on the database first.
 */
export async function provisionDatabase(
  dependencies: DatabaseRunDependencies,
  databaseId: string,
  signal: AbortSignal,
): Promise<void> {
  const record = findDatabaseRecord(dependencies.database, databaseId);
  // Deleted, or about to be, while the job waited in the queue.
  if (record == null || record.deletionRequestedAt != null) {
    return;
  }
  try {
    await startDatabase(dependencies, record, signal);
  } catch (error) {
    markDatabaseFailed(dependencies.database, databaseId, errorMessage(error));
    throw error;
  }
  markDatabaseRunning(dependencies.database, databaseId);
}

async function startDatabase(
  dependencies: DatabaseRunDependencies,
  record: DatabaseRecord,
  signal: AbortSignal,
): Promise<void> {
  const { docker, network } = dependencies;
  const containerName = databaseContainerNameFor(record.id);
  const existing = await docker.inspectContainer(containerName);
  if (existing?.running === true) {
    await waitUntilReady(dependencies, record, signal);
    return;
  }
  // A container left stopped by an earlier attempt; its data stays in the volume.
  if (existing != null) {
    await docker.removeContainer(containerName);
  }
  const engine = databaseEngine(record.engine);
  const settings = engine.containerSettings(
    await readDatabasePassword(dependencies.secretBox, record),
  );
  const volumeName = databaseVolumeNameFor(record.id);
  await docker.images.ensurePulled(record.imageTag);
  await docker.ensureNetwork(network);
  await docker.volumes.ensure(volumeName, record.projectId);
  await docker.runContainer(
    {
      containerName,
      imageTag: record.imageTag,
      network,
      labels: { [LABELS.managed]: "true", [LABELS.databaseProjectId]: record.projectId },
      environmentKeys: Object.keys(settings.environment),
      volumes: [{ name: volumeName, target: engine.dataPath }],
      command: settings.command,
    },
    settings.environment,
  );
  await waitUntilReady(dependencies, record, signal);
}

async function waitUntilReady(
  { docker, readiness = DEFAULT_READINESS }: DatabaseRunDependencies,
  record: DatabaseRecord,
  signal: AbortSignal,
): Promise<void> {
  await pollUntilReady({ docker, readiness, signal, record }, Date.now() + readiness.timeoutInMs);
}

// Polls one step at a time: each check must finish before the next one starts.
async function pollUntilReady(
  context: {
    readonly docker: DockerEngine;
    readonly readiness: Readiness;
    readonly signal: AbortSignal;
    readonly record: DatabaseRecord;
  },
  deadline: number,
): Promise<void> {
  const { docker, readiness, signal, record } = context;
  const containerName = databaseContainerNameFor(record.id);
  if (Date.now() >= deadline) {
    const timeoutInSeconds = Math.round(readiness.timeoutInMs / MS_PER_SECOND);
    throw new Error(
      `Database container ${containerName} did not accept connections within ${timeoutInSeconds} s`,
    );
  }
  signal.throwIfAborted();
  const container = await docker.inspectContainer(containerName);
  if (container?.running !== true) {
    throw new Error(`Database container ${containerName} stopped while starting`);
  }
  const engine = databaseEngine(record.engine);
  const result = await docker.execInContainer(containerName, engine.readinessCommand, {
    timeoutInMs: READINESS_COMMAND_TIMEOUT_IN_MS,
    signal,
  });
  if (engine.isReady(result)) {
    return;
  }
  await Bun.sleep(readiness.intervalInMs);
  await pollUntilReady(context, deadline);
}

/**
 * Removes a database container and its data volume, then the database itself.
 *
 * @param dependencies - Database and Docker of the project's server.
 * @param databaseId - Database to remove.
 * @throws {DockerCommandError} When Docker refuses; the reason is stored on the database first.
 */
export async function deleteDatabase(
  dependencies: Pick<DatabaseRunDependencies, "database" | "docker">,
  databaseId: string,
): Promise<void> {
  const { database, docker } = dependencies;
  const record = findDatabaseRecord(database, databaseId);
  if (record == null) {
    return;
  }
  try {
    const containerName = databaseContainerNameFor(record.id);
    if ((await docker.inspectContainer(containerName)) != null) {
      await docker.removeContainer(containerName);
    }
    // A database that never started has no volume yet.
    const volumeName = databaseVolumeNameFor(record.id);
    if ((await docker.volumes.listForProject(record.projectId)).includes(volumeName)) {
      await docker.volumes.remove(volumeName);
    }
  } catch (error) {
    failDatabaseDeletion(database, databaseId, errorMessage(error));
    throw error;
  }
  finishDatabaseDeletion(database, databaseId);
}

function databaseIdOf(job: Job): string {
  const databaseId = job.payload["databaseId"];
  if (typeof databaseId !== "string" || databaseId === "") {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its database id`);
  }
  return databaseId;
}

function runDependencies(
  dependencies: Pick<WorkerDependencies, "database" | "hosts" | "secretBox" | "config">,
  job: Job,
): DatabaseRunDependencies {
  const { database, hosts, secretBox, config } = dependencies;
  // Projects with databases cannot move, so the database is on the project's current server.
  const host = hosts.hostOf(database, getProject(database, job.projectId).serverId);
  return { database, docker: host.docker, secretBox, network: config.DOCKER_NETWORK };
}

/**
 * Runs a `database_provision` job on the server of the database's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the database.
 * @param signal - Aborts the wait when the worker shuts down.
 * @throws {Error} When the payload has no database id, or provisioning fails.
 */
export async function runDatabaseProvisionJob(
  dependencies: Pick<WorkerDependencies, "database" | "hosts" | "secretBox" | "config">,
  job: Job,
  signal: AbortSignal,
): Promise<void> {
  await provisionDatabase(runDependencies(dependencies, job), databaseIdOf(job), signal);
}

/**
 * Runs a `database_delete` job on the server of the database's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the database.
 * @throws {Error} When the payload has no database id, or the deletion fails.
 */
export async function runDatabaseDeleteJob(
  dependencies: Pick<WorkerDependencies, "database" | "hosts" | "secretBox" | "config">,
  job: Job,
): Promise<void> {
  await deleteDatabase(runDependencies(dependencies, job), databaseIdOf(job));
}
