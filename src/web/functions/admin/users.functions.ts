import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createUser,
  getAuth,
  listUsers,
  resetUserPassword,
  setUserDisabled,
  updateUserRole,
  userActor,
} from "@/auth";
import { getDatabase } from "@/db";
import { ROLES } from "@/shared/roles";
import { newUserSchema, passwordSchema } from "@/shared/schemas/user.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "../ids";

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("user:manage");
  return listUsers(getDatabase());
});

export const createUserFn = createServerFn({ method: "POST" })
  .validator(newUserSchema)
  .handler(async ({ data }) => {
    const user = await authorize("user:manage");
    return await createUser(getAuth(), getDatabase(), { newUser: data, actor: userActor(user) });
  });

export const updateUserRoleFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: idSchema, role: z.enum(ROLES) }))
  .handler(async ({ data }) => {
    const user = await authorize("user:manage");
    updateUserRole(getDatabase(), { userId: data.userId, role: data.role, actor: userActor(user) });
  });

export const setUserDisabledFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: idSchema, disabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await authorize("user:manage");
    setUserDisabled(getDatabase(), {
      userId: data.userId,
      disabled: data.disabled,
      actor: userActor(user),
    });
  });

export const resetUserPasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: idSchema, password: passwordSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("user:manage");
    await resetUserPassword(getAuth(), getDatabase(), {
      userId: data.userId,
      password: data.password,
      actor: userActor(user),
    });
  });
