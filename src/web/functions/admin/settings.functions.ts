import { createServerFn } from "@tanstack/react-start";

import { sendAlert } from "@/alerts";
import { getConfig } from "@/config";
import { getDatabase, listBackups } from "@/db";
import { getGitHubApp } from "@/github";
import { getWorkerStatus } from "@/monitoring";
import { getSystemSettings, saveSystemSettings } from "@/settings";
import { systemSettingsSchema } from "@/shared/schemas/settings.schema";
import { authorize } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";

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
      githubApp: getGitHubApp(database),
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

/** Sends a test message to the saved alert webhook. */
export const sendTestAlertFn = createServerFn({ method: "POST" }).handler(async () => {
  await authorize("settings:write");
  const webhookUrl = getSystemSettings(getDatabase()).alertWebhookUrl;
  if (webhookUrl == null) {
    throw new PublicError("Salve a URL do webhook antes de enviar um teste.");
  }
  await sendAlert(webhookUrl, {
    title: "Teste",
    text: "Os alertas do Nelcota Deploy vão chegar aqui.",
    link: getConfig().PUBLIC_URL,
  });
});
