import { and, asc, count, desc, eq, gte, inArray, isNull, lt, notInArray } from "drizzle-orm";

import { type Database, tables } from "@/db";

/** A worker is considered offline after this long without a heartbeat. */
const WORKER_OFFLINE_AFTER_IN_MS = 30_000;
const MAX_SERIES_POINTS = 2000;
const RECENT_DEPLOYMENTS = 8;
const RECENT_FAILURE_WINDOW_IN_MS = 86_400_000;

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
 * @param sample - Reading; unavailable values stay null.
 * @param now - Sample time.
 */
export function recordHostSample(
  database: Database,
  sample: HostSample,
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
 * @param samples - One reading per running project container.
 * @param now - Sample time.
 */
export function recordContainerSamples(
  database: Database,
  samples: readonly ContainerSample[],
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
        ...sample,
        diskUsedBytes: null,
        diskTotalBytes: null,
        createdAt: now.toISOString(),
      })),
    )
    .run();
}

/**
 * Replaces the stored view of platform containers with what docker reports now.
 *
 * @param database - Database.
 * @param snapshots - Every platform container that exists.
 */
export function replaceContainerSnapshots(
  database: Database,
  snapshots: readonly ContainerSnapshot[],
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
    const kept = snapshots.filter((snapshot) => knownProjects.has(snapshot.projectId));
    const keptIds = kept.map((snapshot) => snapshot.containerId);
    transaction
      .delete(tables.containerSnapshots)
      .where(
        keptIds.length === 0
          ? undefined
          : notInArray(tables.containerSnapshots.containerId, keptIds),
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
 * Lists host samples since a time, oldest first.
 *
 * @param database - Database.
 * @param since - Start of the window.
 * @returns Up to 2000 samples.
 */
export function listHostSamples(database: Database, since: Date) {
  return database
    .select(sampleColumns)
    .from(tables.metricSamples)
    .where(
      and(
        eq(tables.metricSamples.scope, "host"),
        gte(tables.metricSamples.createdAt, since.toISOString()),
      ),
    )
    .orderBy(asc(tables.metricSamples.createdAt))
    .limit(MAX_SERIES_POINTS)
    .all();
}

/**
 * Returns the newest host sample.
 *
 * @param database - Database.
 * @returns The sample, or null when none was collected.
 */
export function getLatestHostSample(database: Database) {
  return (
    database
      .select(sampleColumns)
      .from(tables.metricSamples)
      .where(eq(tables.metricSamples.scope, "host"))
      .orderBy(desc(tables.metricSamples.createdAt))
      .limit(1)
      .get() ?? null
  );
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

/** Overall state shown on the dashboard. */
type EnvironmentHealth = "healthy" | "degraded" | "unavailable";

/**
 * Builds the dashboard summary in a fixed number of queries.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns Counts, recent activity, latest host sample and overall health.
 */
export function getDashboardSummary(database: Database, now: Date = new Date()) {
  const projects = database
    .select({ id: tables.projects.id, currentDeploymentId: tables.projects.currentDeploymentId })
    .from(tables.projects)
    .where(isNull(tables.projects.deletionRequestedAt))
    .all();
  const currentDeploymentIds = projects
    .map((project) => project.currentDeploymentId)
    .filter((id): id is string => id != null);
  const runningCurrent =
    currentDeploymentIds.length === 0
      ? []
      : database
          .select({
            deploymentId: tables.containerSnapshots.deploymentId,
            health: tables.containerSnapshots.health,
          })
          .from(tables.containerSnapshots)
          .where(
            and(
              inArray(tables.containerSnapshots.deploymentId, currentDeploymentIds),
              eq(tables.containerSnapshots.state, "running"),
            ),
          )
          .all();
  const onlineDeployments = new Set(runningCurrent.map((snapshot) => snapshot.deploymentId));
  const online = projects.filter(
    (project) =>
      project.currentDeploymentId != null && onlineDeployments.has(project.currentDeploymentId),
  ).length;
  const deployedProjects = projects.filter((project) => project.currentDeploymentId != null).length;
  const unhealthy = runningCurrent.filter((snapshot) => snapshot.health === "unhealthy").length;

  const recentColumns = {
    id: tables.deployments.id,
    projectId: tables.deployments.projectId,
    projectName: tables.projects.name,
    status: tables.deployments.status,
    trigger: tables.deployments.trigger,
    commitSha: tables.deployments.commitSha,
    commitMessage: tables.deployments.commitMessage,
    errorMessage: tables.deployments.errorMessage,
    createdAt: tables.deployments.createdAt,
    startedAt: tables.deployments.startedAt,
    finishedAt: tables.deployments.finishedAt,
  };
  const recentDeployments = database
    .select(recentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .orderBy(desc(tables.deployments.createdAt))
    .limit(RECENT_DEPLOYMENTS)
    .all();
  const lastDayStart = new Date(now.getTime() - RECENT_FAILURE_WINDOW_IN_MS).toISOString();
  // The lists above are capped for display; the dashboard figures need the real totals.
  const lastDayCounts = database
    .select({ status: tables.deployments.status, total: count() })
    .from(tables.deployments)
    .where(gte(tables.deployments.createdAt, lastDayStart))
    .groupBy(tables.deployments.status)
    .all();
  const recentFailures = database
    .select(recentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(
      and(eq(tables.deployments.status, "failed"), gte(tables.deployments.createdAt, lastDayStart)),
    )
    .orderBy(desc(tables.deployments.createdAt))
    .limit(RECENT_DEPLOYMENTS)
    .all();

  const worker = getWorkerStatus(database, now);
  const offline = deployedProjects - online;
  let health: EnvironmentHealth = "healthy";
  if (worker == null || worker.online === false || worker.dockerAvailable === false) {
    health = "unavailable";
  } else if (offline > 0 || unhealthy > 0) {
    health = "degraded";
  }

  return {
    projectCount: projects.length,
    onlineCount: online,
    offlineCount: offline,
    neverDeployedCount: projects.length - deployedProjects,
    unhealthyCount: unhealthy,
    deploymentsLastDayCount: lastDayCounts.reduce((sum, row) => sum + row.total, 0),
    failuresLastDayCount: lastDayCounts.find((row) => row.status === "failed")?.total ?? 0,
    recentDeployments,
    recentFailures,
    hostSample: getLatestHostSample(database),
    worker,
    health,
  };
}
