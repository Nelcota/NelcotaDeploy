import { desc, inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";

type CurrentDeployment = { readonly currentDeploymentId: string | null };
type RuntimeSnapshot = { readonly state: string; readonly health: string | null };

export type ProjectRuntimeStatus =
  | "never-deployed"
  | "unmonitored"
  | "offline"
  | "unhealthy"
  | "online";

/** Reads only snapshots of current releases, newest first within each release. */
export function listCurrentProjectSnapshots(
  database: Database,
  projects: readonly CurrentDeployment[],
) {
  const deploymentIds = projects
    .map((project) => project.currentDeploymentId)
    .filter((id) => id != null);
  const snapshots =
    deploymentIds.length === 0
      ? []
      : database
          .select({
            deploymentId: tables.containerSnapshots.deploymentId,
            state: tables.containerSnapshots.state,
            health: tables.containerSnapshots.health,
          })
          .from(tables.containerSnapshots)
          .where(inArray(tables.containerSnapshots.deploymentId, deploymentIds))
          .orderBy(desc(tables.containerSnapshots.observedAt))
          .all();

  return Map.groupBy(snapshots, (snapshot) => snapshot.deploymentId);
}

/** Rates a published release using all observed replicas. */
export function projectRuntimeStatus(
  deploymentId: string | null,
  snapshots: readonly RuntimeSnapshot[],
): ProjectRuntimeStatus {
  if (deploymentId == null) {
    return "never-deployed";
  }

  if (snapshots.length === 0) {
    return "unmonitored";
  }

  const running = snapshots.filter((snapshot) => snapshot.state === "running");
  if (running.length === 0) {
    return "offline";
  }

  return running.some((snapshot) => snapshot.health === "unhealthy") ? "unhealthy" : "online";
}
