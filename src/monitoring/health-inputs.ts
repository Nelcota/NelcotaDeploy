import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { type Database, tables } from "@/db";

/** A deployed project and the snapshot of its live container, if the worker saw one. */
type LiveAppContainer = {
  readonly projectId: string;
  readonly projectName: string;
  /** Server the project runs on. */
  readonly serverId: string;
  readonly container: { readonly state: string; readonly restartCount: number } | null;
};

/**
 * Lists every deployed project with the snapshot of its live container, in one query.
 *
 * @param database - Database.
 * @returns One entry per project with a live deployment; `container` is null when the worker
 *   saw no container for that deployment.
 */
export function listLiveAppContainers(database: Database): LiveAppContainer[] {
  return database
    .select({
      projectId: tables.projects.id,
      projectName: tables.projects.name,
      serverId: tables.projects.serverId,
      state: tables.containerSnapshots.state,
      restartCount: tables.containerSnapshots.restartCount,
    })
    .from(tables.projects)
    .leftJoin(
      tables.containerSnapshots,
      eq(tables.containerSnapshots.deploymentId, tables.projects.currentDeploymentId),
    )
    .where(
      and(
        isNotNull(tables.projects.currentDeploymentId),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .all()
    .map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      serverId: row.serverId,
      container:
        row.state == null ? null : { state: row.state, restartCount: row.restartCount ?? 0 },
    }));
}
