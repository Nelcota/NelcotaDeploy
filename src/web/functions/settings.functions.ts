import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { listAuditEvents } from "@/audit";
import {
  createApiToken,
  createUser,
  getAuth,
  listApiTokens,
  listUsers,
  resetUserPassword,
  revokeApiToken,
  setUserDisabled,
  updateUserRole,
  userActor,
} from "@/auth";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getLatestHostSample, getWorkerStatus } from "@/monitoring";
import { getSystemSettings, saveSystemSettings } from "@/settings";
import { ROLES } from "@/shared/roles";
import { systemSettingsSchema } from "@/shared/schemas/settings.schema";
import { newUserSchema, passwordSchema } from "@/shared/schemas/user.schema";
import { authorize } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";
import { listWebhookDeliveries } from "@/webhooks";

import { idSchema } from "./ids";

const MAX_NAME_LENGTH = 80;
const AUDIT_PAGE_SIZE = 50;
const WEBHOOK_PAGE_SIZE = 30;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_TOKEN_DAYS = 365;

export const getSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  const config = getConfig();
  const database = getDatabase();
  return {
    settings: getSystemSettings(database),
    server: {
      publicUrl: config.PUBLIC_URL,
      webhookUrl: `${config.PUBLIC_URL}/api/webhooks/github`,
      webhookConfigured: config.GITHUB_WEBHOOK_SECRET != null,
      encryptionConfigured: config.NELCOTA_ENCRYPTION_KEY != null,
      dockerNetwork: config.DOCKER_NETWORK,
      traefikEnabled: config.TRAEFIK_ENABLED,
      workerConcurrency: config.WORKER_CONCURRENCY,
      metricsIntervalInSeconds: config.METRICS_INTERVAL_SECONDS,
      metricsRetentionInHours: config.METRICS_RETENTION_HOURS,
      scheduleTimeZone: config.SCHEDULE_TIME_ZONE,
      worker: getWorkerStatus(database),
      hostSample: getLatestHostSample(database),
    },
  };
});

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator(systemSettingsSchema)
  .handler(async ({ data }) => {
    await authorize("settings:write");
    saveSystemSettings(getDatabase(), data);
  });

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
    if (data.userId === user.id) {
      throw new PublicError("Você não pode alterar o próprio papel.");
    }
    updateUserRole(getDatabase(), { userId: data.userId, role: data.role, actor: userActor(user) });
  });

export const setUserDisabledFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: idSchema, disabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await authorize("user:manage");
    if (data.userId === user.id && data.disabled) {
      throw new PublicError("Você não pode desativar a própria conta.");
    }
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

export const listAuditEventsFn = createServerFn({ method: "GET" })
  .validator(z.object({ before: z.iso.datetime().optional() }))
  .handler(async ({ data }) => {
    await authorize("audit:read");
    return listAuditEvents(getDatabase(), { limit: AUDIT_PAGE_SIZE, before: data.before }).map(
      (event) => ({
        id: event.id,
        actorType: event.actorType,
        actorLabel: event.actorLabel,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        details: JSON.stringify(event.metadata),
        createdAt: event.createdAt,
      }),
    );
  });

export const listWebhookDeliveriesFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("audit:read");
  return listWebhookDeliveries(getDatabase(), WEBHOOK_PAGE_SIZE);
});
