import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { MAX_AVATAR_BYTES, removeUserAvatar, saveUserAvatar, UnauthenticatedError } from "@/auth";
import { getDatabase } from "@/db";
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

// Base64 grows the content by a third; this fits the largest accepted photo.
const MAX_AVATAR_BASE64_LENGTH = Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 4;

/** Replaces the signed-in user's profile photo with an image sent as base64. */
export const updateAvatarFn = createServerFn({ method: "POST" })
  .validator(z.object({ imageBase64: z.base64().min(1).max(MAX_AVATAR_BASE64_LENGTH) }))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (user == null) {
      throw new UnauthenticatedError();
    }
    return saveUserAvatar(getDatabase(), {
      userId: user.id,
      bytes: Buffer.from(data.imageBase64, "base64"),
    });
  });

/** Removes the signed-in user's profile photo. */
export const removeAvatarFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await currentUser();
  if (user == null) {
    throw new UnauthenticatedError();
  }
  removeUserAvatar(getDatabase(), user.id);
});
