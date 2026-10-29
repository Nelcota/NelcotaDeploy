import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { type Database, tables } from "@/db";

import { getWorkerStatus } from "./monitoring.service";

const RECENT_DEPLOYMENTS = 8;
const RECENT_FAILURE_WINDOW_IN_MS = 86_400_000;

/** Overall state shown on the dashboard. */
type EnvironmentHealth = "healthy" | "degraded" | "unavailable";

type WorkerStatus = ReturnType<typeof getWorkerStatus>;

/**
 * Builds the dashboard summary in a fixed number of queries.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns Counts, recent activity and overall health.
 */
export function getDashboardSummary(database: Database, now: Date = new Date()) {
  const projects = countProjectStates(database);
  const activity = listRecentActivity(database, now);
  const worker = getWorkerStatus(database, now);
  const offline = projects.deployed - projects.online;
  return {
    projectCount: projects.total,
    onlineCount: projects.online,
    offlineCount: offline,
    neverDeployedCount: projects.total - projects.deployed,
    unhealthyCount: projects.unhealthy,
    deploymentsLastDayCount: activity.lastDayCounts.reduce((sum, row) => sum + row.total, 0),
    failuresLastDayCount: activity.lastDayCounts.find((row) => row.status === "failed")?.total ?? 0,
    recentDeployments: activity.recentDeployments,
    recentFailures: activity.recentFailures,
    worker,
    health: environmentHealth(worker, { offline, unhealthy: projects.unhealthy }),
  };
}

/**
 * Rates the environment: unavailable without a working worker and Docker, degraded while any
 * deployed project is offline or unhealthy.
 *
 * @param worker - Latest worker status, or null when no worker ever reported.
 * @param problems - Number of offline and of unhealthy projects.
 * @returns The overall health.
 */
export function environmentHealth(
  worker: WorkerStatus,
  problems: { readonly offline: number; readonly unhealthy: number },
): EnvironmentHealth {
  if (worker == null || worker.online === false || worker.dockerAvailable === false) {
    return "unavailable";
  }
  if (problems.offline > 0 || problems.unhealthy > 0) {
    return "degraded";
  }
  return "healthy";
}

/** Counts active projects, how many have a deployment, and how many of those run. */
function countProjectStates(database: Database) {
  const projects = database
    .select({ id: tables.projects.id, currentDeploymentId: tables.projects.currentDeploymentId })
    .from(tables.projects)
    .where(isNull(tables.projects.deletionRequestedAt))
    .all();
  const currentDeploymentIds = projects
    .map((project) => project.currentDeploymentId)
    .filter((id): id is string => id != null);
  const runningCurrent = listRunningSnapshots(database, currentDeploymentIds);
  const onlineDeployments = new Set(runningCurrent.map((snapshot) => snapshot.deploymentId));
  return {
    total: projects.length,
    deployed: currentDeploymentIds.length,
    online: currentDeploymentIds.filter((id) => onlineDeployments.has(id)).length,
    unhealthy: runningCurrent.filter((snapshot) => snapshot.health === "unhealthy").length,
  };
}

function listRunningSnapshots(database: Database, deploymentIds: readonly string[]) {
  if (deploymentIds.length === 0) {
    return [];
  }
  return database
    .select({
      deploymentId: tables.containerSnapshots.deploymentId,
      health: tables.containerSnapshots.health,
    })
    .from(tables.containerSnapshots)
    .where(
      and(
        inArray(tables.containerSnapshots.deploymentId, deploymentIds),
        eq(tables.containerSnapshots.state, "running"),
      ),
    )
    .all();
}

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

/** Latest deployments, last-day counts per status and last-day failures. */
function listRecentActivity(database: Database, now: Date) {
  const lastDayStart = new Date(now.getTime() - RECENT_FAILURE_WINDOW_IN_MS).toISOString();
  const recentDeployments = database
    .select(recentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .orderBy(desc(tables.deployments.createdAt))
    .limit(RECENT_DEPLOYMENTS)
    .all();
  // The lists are capped for display; the dashboard figures need the real totals.
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
  return { recentDeployments, lastDayCounts, recentFailures };
}
