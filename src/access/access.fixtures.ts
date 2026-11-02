import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { Project } from "@/projects";
import type { Role } from "@/shared/roles";
import { createTestProject } from "@/testing";

const CREATED_AT = new Date("2026-11-02T12:00:00.000Z");

/**
 * Inserts a user with a global role.
 *
 * @param database - Test database.
 * @param id - User id, also used for the name and email.
 * @param role - Global role.
 * @returns The id and role, as access checks take them.
 */
export function insertUser(database: Database, id: string, role: Role) {
  database
    .insert(tables.users)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      role,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  return { id, role };
}

/**
 * Creates a production project and its staging environment.
 *
 * @param database - Test database.
 * @returns Both projects.
 */
export function createProjectWithStaging(database: Database): {
  readonly production: Project;
  readonly staging: Project;
} {
  const production = createTestProject(database);
  const staging = createTestProject(database, { name: "API staging", slug: "api-staging" });
  database
    .update(tables.projects)
    .set({ parentProjectId: production.id, environmentName: "staging" })
    .where(eq(tables.projects.id, staging.id))
    .run();
  return { production, staging };
}
