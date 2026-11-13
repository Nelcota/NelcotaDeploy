import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { ACTIVE_STATUSES } from "@/deployments";
import { listCurrentProjectSnapshots, projectRuntimeStatus } from "@/projects";
import { listHttpsStatus } from "@/uptime";

import { getWorkerStatus } from "./worker-heartbeat.service";

const RECENT_DEPLOYMENTS = 8;
const DASHBOARD_LIST_LIMIT = 5;
const RECENT_FAILURE_WINDOW_IN_MS = 86_400_000;

/** Overall state shown on the dashboard. */
type EnvironmentHealth = "healthy" | "degraded" | "unavailable";

type WorkerStatus = ReturnType<typeof getWorkerStatus>;

/**
 * Builds the dashboard summary in a fixed number of queries.
 *
 * @param database - Database.
 * @param now - Current time.
 * @param projectIds - The only projects to summarize; null summarizes every project.
 * @returns Counts, recent activity and overall health.
 */
export function getDashboardSummary(
  database: Database,
  now: Date = new Date(),
  projectIds: readonly string[] | null = null,
) {
  const projects = countProjectStates(database, projectIds);
  const activity = listRecentActivity(database, now, projectIds);
  const activeDeployments = listActiveDashboardDeployments(database, projectIds);
  const worker = getWorkerStatus(database, now);
  const { issues: httpsIssues, recoveries: httpsRecoveries } = listHttpsStatus(
    database,
    now,
    projectIds,
  );
  const { offline, unmonitored, unhealthy } = projects.counts;
  return {
    projectCount: projects.total,
    onlineCount: projects.counts.online + unhealthy,
    offlineCount: offline,
    unmonitoredCount: unmonitored,
    neverDeployedCount: projects.counts["never-deployed"],
    unhealthyCount: unhealthy,
    projectsNeedingAttention: projects.needingAttention,
    activeDeployments,
    httpsIssueCount: httpsIssues.length,
    httpsIssues: httpsIssues.slice(0, DASHBOARD_LIST_LIMIT),
    httpsRecoveries: httpsRecoveries.slice(0, DASHBOARD_LIST_LIMIT),
    deploymentsLastDayCount: activity.lastDayCounts.reduce((sum, row) => sum + row.total, 0),
    failuresLastDayCount: activity.lastDayCounts.find((row) => row.status === "failed")?.total ?? 0,
    recentDeployments: activity.recentDeployments,
    recentFailures: activity.recentFailures,
    worker,
    health: environmentHealth(worker, { offline: offline + unmonitored, unhealthy }),
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

/** Counts each project once and keeps a short preview of projects needing attention. */
function countProjectStates(database: Database, projectIds: readonly string[] | null) {
  const projects = database
    .select({
      id: tables.projects.id,
      name: tables.projects.name,
      currentDeploymentId: tables.projects.currentDeploymentId,
    })
    .from(tables.projects)
    .where(
      and(
        isNull(tables.projects.deletionRequestedAt),
        projectIds == null ? undefined : inArray(tables.projects.id, projectIds),
      ),
    )
    .orderBy(asc(tables.projects.name), asc(tables.projects.id))
    .all();
  const snapshots = listCurrentProjectSnapshots(database, projects);
  const counts = { "never-deployed": 0, unmonitored: 0, offline: 0, unhealthy: 0, online: 0 };
  const needingAttention: {
    id: string;
    name: string;
    status: "offline" | "unhealthy" | "unmonitored";
  }[] = [];
  for (const { id, name, currentDeploymentId } of projects) {
    const status = projectRuntimeStatus(
      currentDeploymentId,
      snapshots.get(currentDeploymentId) ?? [],
    );
    counts[status] += 1;

    if (
      needingAttention.length < DASHBOARD_LIST_LIMIT &&
      status !== "online" &&
      status !== "never-deployed"
    ) {
      needingAttention.push({ id, name, status });
    }
  }

  return {
    total: projects.length,
    counts,
    needingAttention,
  };
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

// The dashboard is about production; previews appear on their project's page.
const PRODUCTION = isNull(tables.deployments.previewId);

function listActiveDashboardDeployments(database: Database, projectIds: readonly string[] | null) {
  return database
    .select({
      id: tables.deployments.id,
      projectId: tables.deployments.projectId,
      projectName: tables.projects.name,
      status: tables.deployments.status,
      branch: tables.deployments.branch,
    })
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(
      and(
        PRODUCTION,
        isNull(tables.projects.deletionRequestedAt),
        inArray(tables.deployments.status, ACTIVE_STATUSES),
        projectIds == null ? undefined : inArray(tables.deployments.projectId, projectIds),
      ),
    )
    .orderBy(
      desc(tables.deployments.startedAt),
      asc(tables.deployments.createdAt),
      asc(tables.deployments.id),
    )
    .limit(DASHBOARD_LIST_LIMIT)
    .all();
}

/** Latest deployments, last-day counts per status and last-day failures. */
function listRecentActivity(database: Database, now: Date, projectIds: readonly string[] | null) {
  const lastDayStart = new Date(now.getTime() - RECENT_FAILURE_WINDOW_IN_MS).toISOString();
  const visible = and(
    PRODUCTION,
    projectIds == null ? undefined : inArray(tables.deployments.projectId, projectIds),
  );
  const recentDeployments = database
    .select(recentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(visible)
    .orderBy(desc(tables.deployments.createdAt))
    .limit(RECENT_DEPLOYMENTS)
    .all();
  // The lists are capped for display; the dashboard figures need the real totals.
  const lastDayCounts = database
    .select({ status: tables.deployments.status, total: count() })
    .from(tables.deployments)
    .where(and(gte(tables.deployments.createdAt, lastDayStart), visible))
    .groupBy(tables.deployments.status)
    .all();
  const recentFailures = database
    .select(recentColumns)
    .from(tables.deployments)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.deployments.projectId))
    .where(
      and(
        eq(tables.deployments.status, "failed"),
        gte(tables.deployments.createdAt, lastDayStart),
        visible,
      ),
    )
    .orderBy(desc(tables.deployments.createdAt))
    .limit(RECENT_DEPLOYMENTS)
    .all();
  return { recentDeployments, lastDayCounts, recentFailures };
}
