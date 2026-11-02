import { hasPermission, type Permission, type Role } from "@/shared/roles";

const UI_PERMISSIONS: Permission[] = [
  "project:write",
  "project:delete",
  "project:approve",
  "deployment:create",
  "container:control",
  "environment:write",
  "domain:write",
  "task:write",
  "task:run",
  "user:manage",
  "settings:write",
  "token:manage",
  "audit:read",
];

/**
 * Lists the permissions the interface checks to show its controls, as a role grants them.
 *
 * @param role - Global role of the user, or their role on the project being shown.
 * @returns The granted permissions.
 */
export function uiPermissionsOf(role: Role): Permission[] {
  return UI_PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
