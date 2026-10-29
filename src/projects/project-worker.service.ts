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
