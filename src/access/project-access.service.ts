import { and, eq, inArray, or } from "drizzle-orm";

import { ForbiddenError } from "@/auth";
import { type Database, tables, type Transaction } from "@/db";
import { getProject, ProjectNotFoundError } from "@/projects";
import { type AccessRole, hasPermission, type Permission, type Role } from "@/shared/roles";

/** The user asking for a project, as access checks see them. */
export type ProjectAccessUser = { readonly id: string; readonly role: Role };

/**
 * Finds the production project whose members decide who reaches a project.
 *
 * @param database - Database or open transaction.
 * @param projectId - A production project or one of its environments, such as staging.
 * @returns The id of the production project.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 */
export function membershipProjectId(database: Database | Transaction, projectId: string): string {
  const project = getProject(database, projectId);
  return project.parentProjectId ?? project.id;
}

/**
 * Finds the role a user has on a project. Admins act as admins on every project; other users
 * have the role of their membership in the production project.
 *
 * @param database - Database.
 * @param user - Id and global role of the user.
 * @param projectId - Project being reached, production or an environment of it.
 * @returns The role, or null when the user is not a member.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 */
export function projectRoleOf(
  database: Database,
  user: ProjectAccessUser,
  projectId: string,
): AccessRole | null {
  const rootProjectId = membershipProjectId(database, projectId);
  if (user.role === "admin") {
    return "admin";
  }
  const membership = database
    .select({ role: tables.projectMembers.role })
    .from(tables.projectMembers)
    .where(
      and(
        eq(tables.projectMembers.projectId, rootProjectId),
        eq(tables.projectMembers.userId, user.id),
      ),
    )
    .get();
  return membership?.role ?? null;
}

/**
 * Checks that a user may perform an action on a project.
 *
 * @param database - Database.
 * @param user - Id and global role of the user.
 * @param request - Project being reached, production or an environment of it, and the
 * permission the action needs.
 * @returns The user's role on the project.
 * @throws {ProjectNotFoundError} When the project does not exist, is being deleted or the user
 * is not a member, so outsiders cannot tell which projects exist.
 * @throws {ForbiddenError} When the member's role lacks the permission.
 */
export function assertProjectPermission(
  database: Database,
  user: ProjectAccessUser,
  request: { readonly projectId: string; readonly permission: Permission },
): AccessRole {
  const { projectId, permission } = request;
  const role = projectRoleOf(database, user, projectId);
  if (role == null) {
    throw new ProjectNotFoundError(projectId);
  }
  if (hasPermission(role, permission) === false) {
    throw new ForbiddenError(permission);
  }
  return role;
}

/**
 * Lists the projects a user may see: production projects they are a member of and the
 * environments of those projects.
 *
 * @param database - Database.
 * @param user - Id and global role of the user.
 * @returns Project ids, or null for an admin, who sees every project.
 */
export function accessibleProjectIds(database: Database, user: ProjectAccessUser): string[] | null {
  if (user.role === "admin") {
    return null;
  }
  const memberOf = database
    .select({ projectId: tables.projectMembers.projectId })
    .from(tables.projectMembers)
    .where(eq(tables.projectMembers.userId, user.id))
    .all()
    .map((membership) => membership.projectId);
  if (memberOf.length === 0) {
    return [];
  }
  return database
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(
      or(inArray(tables.projects.id, memberOf), inArray(tables.projects.parentProjectId, memberOf)),
    )
    .all()
    .map((project) => project.id);
}
