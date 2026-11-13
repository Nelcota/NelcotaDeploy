import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { listLiveDomains } from "@/domains";
import { getSystemSettings } from "@/settings";
import { httpsRecoveryAt } from "@/shared/https";

const CHECK_FRESHNESS_IN_MS = 180_000;
const RECOVERY_WINDOW_IN_MS = 1_800_000;
const OUTAGE_LOOKBACK_IN_MS = 1_800_000;

type HttpsDomain = {
  readonly projectId: string;
  readonly projectName: string;
  readonly hostname: string;
};

/** Lists active certificate failures and recent recoveries for visible, published HTTPS domains. */
export function listHttpsStatus(
  database: Database,
  now: Date,
  projectIds: readonly string[] | null,
) {
  const issues: HttpsDomain[] = [];
  const recoveries: (HttpsDomain & { readonly recoveredAt: string })[] = [];
  const domains = listLiveDomains(
    database,
    getSystemSettings(database, { includeSecrets: false }),
    projectIds,
  ).filter((domain) => domain.httpsEnabled);
  if (domains.length === 0) {
    return { issues, recoveries };
  }

  const visibleProjects = [...new Set(domains.map((domain) => domain.projectId))];
  const freshSince = now.getTime() - CHECK_FRESHNESS_IN_MS;
  const recoverySince = now.getTime() - RECOVERY_WINDOW_IN_MS;
  const since = new Date(recoverySince - OUTAGE_LOOKBACK_IN_MS).toISOString();
  const { uptimeChecks, uptimeStates, projects, deployments } = tables;
  const checks = database
    .select({
      projectId: uptimeChecks.projectId,
      hostname: uptimeChecks.hostname,
      checkedAt: uptimeChecks.checkedAt,
      up: uptimeChecks.up,
      reason: uptimeChecks.error,
      publishedAt: sql<string>`coalesce(${deployments.finishedAt}, ${deployments.createdAt})`,
    })
    .from(uptimeChecks)
    .innerJoin(projects, eq(projects.id, uptimeChecks.projectId))
    .innerJoin(deployments, eq(deployments.id, projects.currentDeploymentId))
    .innerJoin(
      uptimeStates,
      and(
        eq(uptimeStates.hostname, uptimeChecks.hostname),
        eq(uptimeStates.projectId, uptimeChecks.projectId),
      ),
    )
    .where(
      and(
        inArray(uptimeChecks.projectId, visibleProjects),
        ne(uptimeStates.status, "private"),
        gte(uptimeChecks.checkedAt, since),
      ),
    )
    .orderBy(asc(uptimeChecks.checkedAt), asc(uptimeChecks.id))
    .all();

  const checksByHostname = Map.groupBy(checks, (check) => check.hostname);
  for (const { projectId, projectName, hostname } of domains) {
    const recent = checksByHostname.get(hostname);
    const latest = recent?.at(-1);
    if (recent == null || latest == null || latest.projectId !== projectId) {
      continue;
    }

    const latestAt = Date.parse(latest.checkedAt);
    const publishedAt = Date.parse(latest.publishedAt);
    if (
      Number.isFinite(latestAt) === false ||
      Number.isFinite(publishedAt) === false ||
      latestAt < Math.max(freshSince, publishedAt)
    ) {
      continue;
    }

    if (latest.up === false && latest.reason === "certificate") {
      issues.push({ projectId, projectName, hostname });
    }

    const recoveredAt = httpsRecoveryAt(recent);
    if (recoveredAt != null && Date.parse(recoveredAt) >= recoverySince) {
      recoveries.push({ projectId, projectName, hostname, recoveredAt });
    }
  }

  return {
    issues: issues.toSorted((left, right) => left.hostname.localeCompare(right.hostname)),
    recoveries: recoveries.toSorted((left, right) =>
      right.recoveredAt.localeCompare(left.recoveredAt),
    ),
  };
}
