import { createServerFn } from "@tanstack/react-start";

import { hasPermission, type Permission } from "@/shared/roles";
import { currentUser } from "@/web/server/authorization";

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

/** Returns the signed-in user and what the interface should let them do, or null. */
export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  if (user == null) {
    return null;
  }
  const permissions = UI_PERMISSIONS.filter((permission) => hasPermission(user.role, permission));
  return { ...user, permissions };
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionFn>>>;
