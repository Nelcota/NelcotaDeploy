import { useRouteContext } from "@tanstack/react-router";
import { createContext, useContext } from "react";

import type { Permission } from "@/shared/roles";

const ProjectPermissionsContext = createContext<readonly Permission[] | null>(null);

/**
 * Gives the pages of one project the permissions of the user's role on it, which replace
 * those of their global role there.
 */
export const ProjectPermissionsProvider = ProjectPermissionsContext.Provider;

/**
 * Tells whether the signed-in user may perform an action, on the current project when inside
 * one. This only hides controls; the server checks every permission again.
 */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useRouteContext({ from: "/_app" });
  const projectPermissions = useContext(ProjectPermissionsContext);
  const permissions = projectPermissions ?? user.permissions;
  return (permission) => permission === "project:read" || permissions.includes(permission);
}
