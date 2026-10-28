import { useRouteContext } from "@tanstack/react-router";

import type { Permission } from "@/shared/roles";

/**
 * Tells whether the signed-in user may perform an action. This only hides controls; the
 * server checks every permission again.
 */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useRouteContext({ from: "/_app" });
  return (permission) => permission === "project:read" || user.permissions.includes(permission);
}
