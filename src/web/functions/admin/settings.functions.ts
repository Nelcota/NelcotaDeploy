import { createServerFn } from "@tanstack/react-start";

import { getConfig } from "@/config";
import { getDatabase, listBackups } from "@/db";
import { getWorkerStatus } from "@/monitoring";
import { getSystemSettings, saveSystemSettings } from "@/settings";
import { systemSettingsSchema } from "@/shared/schemas/settings.schema";
import { authorize } from "@/web/server/authorization";

export const getSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  const config = getConfig();
  const database = getDatabase();
  const backups = config.BACKUP_DIR == null ? [] : await listBackups(config.BACKUP_DIR);
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
      backup: {
        newestAt: backups[0]?.createdAt ?? null,
        count: backups.length,
        kept: config.BACKUPS_KEPT,
      },
    },
  };
});

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator(systemSettingsSchema)
  .handler(async ({ data }) => {
    await authorize("settings:write");
    saveSystemSettings(getDatabase(), data);
  });
