import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { createApiToken, listApiTokens, revokeApiToken, userActor } from "@/auth";
import { getDatabase } from "@/db";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "../ids";

const MAX_NAME_LENGTH = 80;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_TOKEN_DAYS = 365;

export const listApiTokensFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("token:manage");
  return listApiTokens(getDatabase());
});

export const createApiTokenFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().min(1, "Campo obrigatório").max(MAX_NAME_LENGTH),
      scopes: z.array(z.enum(["read", "deploy"])).min(1, "Escolha pelo menos um escopo"),
      expiresInDays: z.number().int().min(1).max(MAX_TOKEN_DAYS).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await authorize("token:manage");
    const expiresAt =
      data.expiresInDays == null
        ? null
        : new Date(Date.now() + data.expiresInDays * MILLISECONDS_PER_DAY).toISOString();
    return createApiToken(
      getDatabase(),
      { name: data.name, scopes: data.scopes, expiresAt, createdByUserId: user.id },
      userActor(user),
    );
  });

export const revokeApiTokenFn = createServerFn({ method: "POST" })
  .validator(z.object({ tokenId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("token:manage");
    revokeApiToken(getDatabase(), data.tokenId, userActor(user));
  });
