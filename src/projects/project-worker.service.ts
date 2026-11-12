import { and, eq } from "drizzle-orm";

import { type Database, tables } from "@/db";

// What the worker reads and writes about projects while it deploys and observes containers.

/**
 * Lists the ids of every project that exists, including ones being deleted.
 *
 * @param database - Database.
 * @returns Project ids.
 */
export function listProjectIds(database: Database): Set<string> {
  return new Set(
    database
      .select({ id: tables.projects.id })
      .from(tables.projects)
      .all()
      .map((project) => project.id),
  );
}

/**
 * Stores the port a build read from the Dockerfile, for a project whose port is automatic.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param port - Port from the EXPOSE instruction, between 1 and 65535.
 */
export function recordDetectedPort(database: Database, projectId: string, port: number): void {
  database
    .update(tables.projects)
    .set({ internalPort: port })
    .where(and(eq(tables.projects.id, projectId), eq(tables.projects.internalPortAuto, true)))
    .run();
}

/**
 * Returns the server id of a project even when deletion was requested, or `null` if gone.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns Server id, or `null`.
 */
export function findProjectServerId(database: Database, projectId: string): string | null {
  return (
    database
      .select({ serverId: tables.projects.serverId })
      .from(tables.projects)
      .where(eq(tables.projects.id, projectId))
      .get()?.serverId ?? null
  );
}

/**
 * Deletes a project row and its cascading history after its resources have been cleaned up.
 *
 * @param database - Database.
 * @param projectId - Project id.
 */
export function deleteProjectRecord(database: Database, projectId: string): void {
  database.delete(tables.projects).where(eq(tables.projects.id, projectId)).run();
}
