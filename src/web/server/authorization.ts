import { getRequest } from "@tanstack/react-start/server";

import {
  type CurrentUser,
  getCurrentUser,
  needsTwoFactorSetup,
  requireUser,
  TwoFactorRequiredError,
} from "@/auth";
import { getDatabase } from "@/db";
import { getSystemSettings } from "@/settings";
import type { Permission } from "@/shared/roles";

/**
 * Checks the session of the current request and a permission.
 *
 * @param permission - Permission the server function needs.
 * @returns The authorized user.
 * @throws {UnauthenticatedError} When there is no valid session.
 * @throws {ForbiddenError} When the user's role lacks the permission.
 * @throws {TwoFactorRequiredError} When an admin must turn on two-factor authentication first.
 */
export async function authorize(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser(getRequest().headers, permission);
  if (needsTwoFactorSetup(user, getSystemSettings(getDatabase()))) {
    throw new TwoFactorRequiredError();
  }
  return user;
}

/**
 * Returns the user of the current request, or null when signed out.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  return await getCurrentUser(getRequest().headers);
}
