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
  /** The user confirmed an authenticator app and signs in with a code as well. */
  readonly twoFactorEnabled: boolean;
  /** Address of the profile photo, or null to show the initials. */
  readonly image: string | null;
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
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    image: user.image ?? null,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
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

/**
 * Tells whether a user must turn on two-factor authentication before using the panel.
 *
 * @param user - Role and two-factor status of the user.
 * @param settings - Whether the organization requires it from admins.
 * @returns True for an admin without two-factor authentication when it is required.
 */
export function needsTwoFactorSetup(
  user: Pick<CurrentUser, "role" | "twoFactorEnabled">,
  settings: { readonly requireAdminTwoFactor: boolean },
): boolean {
  return settings.requireAdminTwoFactor && user.role === "admin" && user.twoFactorEnabled === false;
}
