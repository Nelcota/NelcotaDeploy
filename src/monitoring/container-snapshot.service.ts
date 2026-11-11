import { and, desc, eq, inArray, max, ne, notExists, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type Database, tables } from "@/db";

/** Container state observed by the worker. */
export type ContainerSnapshot = typeof tables.containerSnapshots.$inferInsert;

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
  database.transaction(
    (transaction) => {
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
    },
    { behavior: "immediate" },
  );
}

/**
 * Finds how many times the most restarted container of each deployment restarted, as the
 * worker last saw them, so one replica stuck in a loop stands out.
 *
 * @param database - Database.
 * @param deploymentIds - Deployments to look at.
 * @returns The highest restart count by deployment; deployments without containers are left out.
 */
export function highestRestartCounts(
  database: Database,
  deploymentIds: readonly string[],
): Map<string, number> {
  if (deploymentIds.length === 0) {
    return new Map();
  }
  const rows = database
    .select({
      deploymentId: tables.containerSnapshots.deploymentId,
      restarts: max(tables.containerSnapshots.restartCount),
    })
    .from(tables.containerSnapshots)
    .where(inArray(tables.containerSnapshots.deploymentId, [...deploymentIds]))
    .groupBy(tables.containerSnapshots.deploymentId)
    .all();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.deploymentId != null && row.restarts != null) {
      counts.set(row.deploymentId, row.restarts);
    }
  }
  return counts;
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
