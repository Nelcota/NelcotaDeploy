import { getRequest } from "@tanstack/react-start/server";

import { type CurrentUser, getCurrentUser, requireUser } from "@/auth";
import type { Permission } from "@/shared/roles";

/**
 * Checks the session of the current request and a permission.
 *
 * @param permission - Permission the server function needs.
 * @returns The authorized user.
 * @throws {UnauthenticatedError} When there is no valid session.
 * @throws {ForbiddenError} When the user's role lacks the permission.
 */
export async function authorize(permission: Permission): Promise<CurrentUser> {
  return await requireUser(getRequest().headers, permission);
}

/**
 * Returns the user of the current request, or null when signed out.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  return await getCurrentUser(getRequest().headers);
}
