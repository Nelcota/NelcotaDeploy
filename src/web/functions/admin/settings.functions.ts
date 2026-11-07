import { createServerFn } from "@tanstack/react-start";

import { summarizeBackups } from "@/backups";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getGitHubApp } from "@/github";
import { getWorkerStatus } from "@/monitoring";
import { getSystemSettings, saveSystemSettingsSection } from "@/settings";
import { organizationSettingsChangeSchema } from "@/shared/schemas/settings/organization-settings.schema";
import { authorize } from "@/web/server/authorization";

export const getSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await authorize("project:read");
  const config = getConfig();
  const database = getDatabase();
  return {
    settings: getSystemSettings(database, { includeSecrets: user.role === "admin" }),
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
      backup: await summarizeBackups(config),
    },
  };
});

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator(organizationSettingsChangeSchema)
  .handler(async ({ data }) => {
    await authorize("settings:write");
    return saveSystemSettingsSection(getDatabase(), data);
  });
