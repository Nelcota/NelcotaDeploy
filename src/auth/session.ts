import type { Actor } from "@/audit";
import { hasPermission, isRole, type Permission, type Role } from "@/shared/roles";

import { getAuth } from "./auth";
import { ForbiddenError, UnauthenticatedError } from "./auth.errors";

/** The signed-in user, as seen by authorization checks. */
export type CurrentUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
};

/**
 * Resolves the user from the session cookie in request headers.
 *
 * @param headers - Incoming request headers.
 * @returns The active user, or null when there is no valid session or the user is disabled.
 */
export async function getCurrentUser(headers: Headers): Promise<CurrentUser | null> {
  const result = await getAuth().api.getSession({ headers });
  if (result == null) {
    return null;
  }
  const { user } = result;
  if (user.disabled === true || isRole(user.role) === false) {
    return null;
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * Resolves the user and checks a permission.
 *
 * @param headers - Incoming request headers.
 * @param permission - Permission the operation needs.
 * @returns The authorized user.
 * @throws {UnauthenticatedError} When there is no valid session.
 * @throws {ForbiddenError} When the user's role lacks the permission.
 */
export async function requireUser(headers: Headers, permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser(headers);
  if (user == null) {
    throw new UnauthenticatedError();
  }
  assertPermission(user.role, permission);
  return user;
}

/**
 * Checks a permission for a role.
 *
 * @param role - Role being checked.
 * @param permission - Permission required.
 * @throws {ForbiddenError} When the role lacks the permission.
 */
function assertPermission(role: Role, permission: Permission): void {
  if (hasPermission(role, permission) === false) {
    throw new ForbiddenError(permission);
  }
}

/**
 * Describes a user as the actor of an audited action.
 *
 * @param user - Authenticated user.
 * @returns The audit actor.
 */
export function userActor(user: CurrentUser): Actor {
  return { type: "user", id: user.id, label: user.email };
}
