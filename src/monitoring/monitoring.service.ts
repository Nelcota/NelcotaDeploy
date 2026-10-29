import { and, asc, desc, eq, gte, lt, max, ne, notExists, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type Database, tables } from "@/db";

/** A worker is considered offline after this long without a heartbeat. */
const WORKER_OFFLINE_AFTER_IN_MS = 30_000;
const MAX_SERIES_POINTS = 2000;

/** One host reading. Any field may be null when it could not be measured. */
export type HostSample = {
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
};

/** One container reading attributed to a project. */
export type ContainerSample = {
  readonly projectId: string;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
};

/** Container state observed by the worker. */
export type ContainerSnapshot = typeof tables.containerSnapshots.$inferInsert;

/**
 * Stores a host reading.
 *
 * @param database - Database.
 * @param sample - Reading of the server `serverId`; unavailable values stay null.
 * @param now - Sample time.
 */
export function recordHostSample(
  database: Database,
  sample: HostSample & { readonly serverId: string },
  now: Date = new Date(),
): void {
  database
    .insert(tables.metricSamples)
    .values({ scope: "host", projectId: null, ...sample, createdAt: now.toISOString() })
    .run();
}

/**
 * Stores container readings in one transaction.
 *
 * @param database - Database.
 * @param readings - The `serverId` the containers run on and one of the `samples` per
 *   running project container.
 * @param now - Sample time.
 */
export function recordContainerSamples(
  database: Database,
  {
    serverId,
    samples,
  }: { readonly serverId: string; readonly samples: readonly ContainerSample[] },
  now: Date = new Date(),
): void {
  if (samples.length === 0) {
    return;
  }
  database
    .insert(tables.metricSamples)
    .values(
      samples.map((sample) => ({
        scope: "container" as const,
        serverId,
        ...sample,
        diskUsedBytes: null,
        diskTotalBytes: null,
        createdAt: now.toISOString(),
      })),
    )
    .run();
}

/**
 * Replaces the stored view of one server's platform containers with what its Docker
 * reports now. Other servers' containers are left alone.
 *
 * @param database - Database.
 * @param serverId - Server the containers were listed on.
 * @param snapshots - Every platform container that exists on that server.
 */
export function replaceContainerSnapshots(
  database: Database,
  serverId: string,
  snapshots: readonly Omit<ContainerSnapshot, "serverId">[],
): void {
  database.transaction((transaction) => {
    const knownProjects = new Set(
      transaction
        .select({ id: tables.projects.id })
        .from(tables.projects)
        .all()
        .map((project) => project.id),
    );
    // Containers of deleted projects would violate the foreign key; they are cleaned up separately.
    const kept: ContainerSnapshot[] = [];
    for (const snapshot of snapshots) {
      if (knownProjects.has(snapshot.projectId)) {
        kept.push({ ...snapshot, serverId });
      }
    }
    const keptIds = kept.map((snapshot) => snapshot.containerId);
    transaction
      .delete(tables.containerSnapshots)
      .where(
        and(
          eq(tables.containerSnapshots.serverId, serverId),
          keptIds.length === 0
            ? undefined
            : notInArray(tables.containerSnapshots.containerId, keptIds),
        ),
      )
      .run();
    for (const snapshot of kept) {
      transaction
        .insert(tables.containerSnapshots)
        .values(snapshot)
        .onConflictDoUpdate({ target: tables.containerSnapshots.containerId, set: snapshot })
        .run();
    }
  });
}

/**
 * Records that a worker is alive.
 *
 * @param database - Database.
 * @param heartbeat - Worker identity and Docker availability.
 */
export function recordWorkerHeartbeat(
  database: Database,
  heartbeat: {
    readonly workerId: string;
    readonly startedAt: string;
    readonly dockerAvailable: boolean;
    readonly dockerVersion: string | null;
    readonly now?: Date;
  },
): void {
  const values = {
    workerId: heartbeat.workerId,
    startedAt: heartbeat.startedAt,
    lastSeenAt: (heartbeat.now ?? new Date()).toISOString(),
    dockerAvailable: heartbeat.dockerAvailable,
    dockerVersion: heartbeat.dockerVersion,
  };
  database
    .insert(tables.workerHeartbeats)
    .values(values)
    .onConflictDoUpdate({ target: tables.workerHeartbeats.workerId, set: values })
    .run();
}

/**
 * Returns the most recently seen worker and whether it is online.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns Worker status, or null when no worker ever ran.
 */
export function getWorkerStatus(database: Database, now: Date = new Date()) {
  const worker = database
    .select({
      workerId: tables.workerHeartbeats.workerId,
      startedAt: tables.workerHeartbeats.startedAt,
      lastSeenAt: tables.workerHeartbeats.lastSeenAt,
      dockerAvailable: tables.workerHeartbeats.dockerAvailable,
      dockerVersion: tables.workerHeartbeats.dockerVersion,
    })
    .from(tables.workerHeartbeats)
    .orderBy(desc(tables.workerHeartbeats.lastSeenAt))
    .limit(1)
    .get();
  if (worker == null) {
    return null;
  }
  const online = now.getTime() - new Date(worker.lastSeenAt).getTime() < WORKER_OFFLINE_AFTER_IN_MS;
  return { ...worker, online, dockerAvailable: online && worker.dockerAvailable };
}

const sampleColumns = {
  cpuPercent: tables.metricSamples.cpuPercent,
  memoryUsedBytes: tables.metricSamples.memoryUsedBytes,
  memoryTotalBytes: tables.metricSamples.memoryTotalBytes,
  diskUsedBytes: tables.metricSamples.diskUsedBytes,
  diskTotalBytes: tables.metricSamples.diskTotalBytes,
  createdAt: tables.metricSamples.createdAt,
};

/**
 * Lists host samples of a server since a time, oldest first.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @param since - Start of the window.
 * @returns Up to 2000 samples.
 */
export function listHostSamples(database: Database, serverId: string, since: Date) {
  return database
    .select(sampleColumns)
    .from(tables.metricSamples)
    .where(
      and(
        eq(tables.metricSamples.serverId, serverId),
        eq(tables.metricSamples.scope, "host"),
        gte(tables.metricSamples.createdAt, since.toISOString()),
      ),
    )
    .orderBy(asc(tables.metricSamples.createdAt))
    .limit(MAX_SERIES_POINTS)
    .all();
}

/**
 * Returns the newest host sample of a server.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @returns The sample, or null when none was collected.
 */
export function getLatestHostSample(database: Database, serverId: string) {
  return (
    database
      .select(sampleColumns)
      .from(tables.metricSamples)
      .where(
        and(eq(tables.metricSamples.serverId, serverId), eq(tables.metricSamples.scope, "host")),
      )
      .orderBy(desc(tables.metricSamples.createdAt))
      .limit(1)
      .get() ?? null
  );
}

type HostSampleRow = ReturnType<typeof getLatestHostSample>;

/**
 * Returns the newest host sample of every server, in one query.
 *
 * @param database - Database.
 * @returns Samples keyed by server id; servers without samples are missing.
 */
export function listLatestHostSamples(database: Database): Map<string, NonNullable<HostSampleRow>> {
  const newest = database
    .select({
      serverId: tables.metricSamples.serverId,
      createdAt: max(tables.metricSamples.createdAt).as("newest_created_at"),
    })
    .from(tables.metricSamples)
    .where(eq(tables.metricSamples.scope, "host"))
    .groupBy(tables.metricSamples.serverId)
    .as("newest");
  const rows = database
    .select({ serverId: tables.metricSamples.serverId, ...sampleColumns })
    .from(tables.metricSamples)
    .innerJoin(
      newest,
      and(
        eq(tables.metricSamples.serverId, newest.serverId),
        eq(tables.metricSamples.createdAt, newest.createdAt),
      ),
    )
    .where(eq(tables.metricSamples.scope, "host"))
    .all();
  return new Map(rows.map(({ serverId, ...sample }) => [serverId, sample]));
}

/**
 * Lists container samples of a project since a time, oldest first.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param since - Start of the window.
 * @returns Up to 2000 samples.
 */
export function listProjectSamples(database: Database, projectId: string, since: Date) {
  return database
    .select(sampleColumns)
    .from(tables.metricSamples)
    .where(
      and(
        eq(tables.metricSamples.scope, "container"),
        eq(tables.metricSamples.projectId, projectId),
        gte(tables.metricSamples.createdAt, since.toISOString()),
      ),
    )
    .orderBy(asc(tables.metricSamples.createdAt))
    .limit(MAX_SERIES_POINTS)
    .all();
}

/**
 * Lists the containers the worker last saw for a project.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns Snapshots, newest observation first.
 */
export function listProjectContainers(database: Database, projectId: string) {
  return database
    .select({
      containerId: tables.containerSnapshots.containerId,
      deploymentId: tables.containerSnapshots.deploymentId,
      name: tables.containerSnapshots.name,
      image: tables.containerSnapshots.image,
      state: tables.containerSnapshots.state,
      health: tables.containerSnapshots.health,
      restartCount: tables.containerSnapshots.restartCount,
      startedAt: tables.containerSnapshots.startedAt,
      observedAt: tables.containerSnapshots.observedAt,
    })
    .from(tables.containerSnapshots)
    .where(eq(tables.containerSnapshots.projectId, projectId))
    .orderBy(desc(tables.containerSnapshots.observedAt))
    .all();
}

/** A project whose live container runs on one server but still has containers on another. */
export type MoveLeftover = {
  readonly projectId: string;
  readonly currentServerId: string;
  readonly otherServerId: string;
  /** When the live deployment finished, in UTC ISO 8601. */
  readonly liveSince: string | null;
};

/**
 * Lists containers left on a project's previous server after it moved, in one query.
 *
 * @remarks
 * A project is skipped while any of its deployments is still in progress, and a server is
 * never "previous" while it is where the project is placed: in both cases its container may
 * be the one being deployed right now.
 *
 * @param database - Database.
 * @returns One entry per project and previous server.
 */
export function listMoveLeftovers(database: Database): MoveLeftover[] {
  const inProgress = alias(tables.deployments, "in_progress");
  return database
    .selectDistinct({
      projectId: tables.containerSnapshots.projectId,
      currentServerId: tables.deployments.serverId,
      otherServerId: tables.containerSnapshots.serverId,
      liveSince: tables.deployments.finishedAt,
    })
    .from(tables.containerSnapshots)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.containerSnapshots.projectId))
    .innerJoin(tables.deployments, eq(tables.deployments.id, tables.projects.currentDeploymentId))
    .where(
      and(
        ne(tables.containerSnapshots.serverId, tables.deployments.serverId),
        ne(tables.containerSnapshots.serverId, tables.projects.serverId),
        notExists(
          database
            .select({ id: inProgress.id })
            .from(inProgress)
            .where(
              and(
                eq(inProgress.projectId, tables.projects.id),
                notInArray(inProgress.status, ["succeeded", "failed", "cancelled"]),
              ),
            ),
        ),
      ),
    )
    .all();
}

/**
 * Deletes metric samples older than the retention window.
 *
 * @param database - Database.
 * @param before - Samples created before this time are deleted.
 */
export function pruneMetricSamples(database: Database, before: Date): void {
  database
    .delete(tables.metricSamples)
    .where(lt(tables.metricSamples.createdAt, before.toISOString()))
    .run();
}
