import { getRequest } from "@tanstack/react-start/server";

import { accessibleProjectIds, assertProjectPermission } from "@/access";
import {
  type CurrentUser,
  getCurrentUser,
  needsTwoFactorSetup,
  requireUser,
  TwoFactorRequiredError,
} from "@/auth";
import { getDatabase } from "@/db";
import { getDeployment } from "@/deployments";
import { getSystemSettings } from "@/settings";
import type { Permission } from "@/shared/roles";

/**
 * Checks the session of the current request and a permission of the user's global role.
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
 * Checks the session of the current request and a permission on one project, which comes
 * from the user's membership rather than their global role.
 *
 * @param permission - Permission the server function needs.
 * @param projectId - Project the function acts on.
 * @returns The authorized user.
 * @throws {UnauthenticatedError} When there is no valid session.
 * @throws {TwoFactorRequiredError} When an admin must turn on two-factor authentication first.
 * @throws {ProjectNotFoundError} When the project does not exist or the user is not a member.
 * @throws {ForbiddenError} When the member's role lacks the permission.
 */
export async function authorizeProject(
  permission: Permission,
  projectId: string,
): Promise<CurrentUser> {
  // Every signed-in user may read; what they reach is decided by the membership below.
  const user = await authorize("project:read");
  assertProjectPermission(getDatabase(), user, { projectId, permission });
  return user;
}

/**
 * Checks a permission on the project a deployment belongs to.
 *
 * @param permission - Permission the server function needs.
 * @param deploymentId - Deployment the function acts on.
 * @returns The authorized user.
 * @throws {DeploymentNotFoundError} When the deployment does not exist.
 * @throws {ProjectNotFoundError} When the user is not a member of the deployment's project.
 * @throws {ForbiddenError} When the member's role lacks the permission.
 */
export async function authorizeDeployment(
  permission: Permission,
  deploymentId: string,
): Promise<CurrentUser> {
  const user = await authorize("project:read");
  const { projectId } = getDeployment(getDatabase(), deploymentId);
  assertProjectPermission(getDatabase(), user, { projectId, permission });
  return user;
}

/**
 * Checks the session of the current request and finds which projects the user may see.
 *
 * @returns The user and the ids of their projects, or null ids for an admin, who sees all.
 * @throws {UnauthenticatedError} When there is no valid session.
 * @throws {TwoFactorRequiredError} When an admin must turn on two-factor authentication first.
 */
export async function authorizeProjectListing(): Promise<{
  readonly user: CurrentUser;
  readonly projectIds: string[] | null;
}> {
  const user = await authorize("project:read");
  return { user, projectIds: accessibleProjectIds(getDatabase(), user) };
}

/**
 * Returns the user of the current request, or null when signed out.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  return await getCurrentUser(getRequest().headers);
}
