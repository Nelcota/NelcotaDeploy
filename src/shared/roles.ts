/** Roles a platform user can have, from most to least privileged. */
export const ROLES = ["admin", "developer", "viewer"] as const;

export type Role = (typeof ROLES)[number];

/** Actions guarded by role-based authorization. */
export type Permission =
  | "project:read"
  | "project:write"
  | "project:delete"
  | "project:approve"
  | "deployment:create"
  | "container:control"
  | "environment:write"
  | "domain:write"
  | "task:write"
  | "task:run"
  | "user:manage"
  | "settings:write"
  | "token:manage"
  | "audit:read";

const DEVELOPER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "project:read",
  "project:write",
  "deployment:create",
  "container:control",
  "environment:write",
  "domain:write",
  "task:write",
  "task:run",
]);

const VIEWER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(["project:read"]);

/**
 * Tells whether a role grants a permission.
 *
 * @param role - Role of the authenticated user.
 * @param permission - Action being attempted.
 * @returns True when the role may perform the action.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  switch (role) {
    case "admin":
      return true;
    case "developer":
      return DEVELOPER_PERMISSIONS.has(permission);
    case "viewer":
      return VIEWER_PERMISSIONS.has(permission);
  }
}

/**
 * Narrows an unknown value to a role.
 *
 * @param value - Value read from storage or input.
 * @returns True when the value is a known role.
 */
export function isRole(value: unknown): value is Role {
  return ROLES.some((role) => role === value);
}
