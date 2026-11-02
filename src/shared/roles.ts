/** Roles a platform user can have, from most to least privileged. */
export const ROLES = ["admin", "developer", "viewer"] as const;

export type Role = (typeof ROLES)[number];

/** Roles a member can have on one project; admins reach every project without one. */
export const PROJECT_ROLES = ["manager", "developer", "viewer"] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** A global role, or the role a member has on the project being reached. */
export type AccessRole = Role | ProjectRole;

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
  | "member:manage"
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

// A manager also decides who else reaches the project; the rest stays with admins.
const MANAGER_PERMISSIONS: ReadonlySet<Permission> = DEVELOPER_PERMISSIONS.union(
  new Set<Permission>(["member:manage"]),
);

const VIEWER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(["project:read"]);

/**
 * Tells whether a role grants a permission.
 *
 * @param role - Global role of the authenticated user, or their role on a project.
 * @param permission - Action being attempted.
 * @returns True when the role may perform the action.
 */
export function hasPermission(role: AccessRole, permission: Permission): boolean {
  switch (role) {
    case "admin":
      return true;
    case "manager":
      return MANAGER_PERMISSIONS.has(permission);
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
