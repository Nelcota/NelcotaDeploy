import { queueDueDatabaseBackups } from "@/databases";
import { pruneLogs } from "@/logs";
import { pruneMetricSamples } from "@/monitoring";
import { scheduleDueTasks } from "@/tasks";
import { pruneUptimeChecks } from "@/uptime";

import type { WorkerDependencies } from "../worker.types";
import { rollBackRestartLoops } from "./auto-rollback";
import { backupDatabaseIfDue, runDatabaseBackup } from "./database-backup";
import { checkHealth } from "./health-alerts";
import { cleanUpServers } from "./server-cleanup";
import { checkCertificates, checkUptime } from "./uptime-checks";

const MILLISECONDS_PER_HOUR = 3_600_000;

/** Wraps a duty so a failure is logged and a run never overlaps the previous one. */
type Guard = (name: string, duty: () => Promise<void> | void) => () => Promise<void>;

function scheduleTasks({ database, config, logger }: WorkerDependencies): void {
  const queued = scheduleDueTasks(database, new Date(), config.SCHEDULE_TIME_ZONE);
  if (queued.length > 0) {
    logger.info({ executions: queued.length }, "scheduled tasks queued");
  }
}

function queueDatabaseBackups({ database, logger }: WorkerDependencies): void {
  const queued = queueDueDatabaseBackups(database, new Date());
  if (queued > 0) {
    logger.info({ backups: queued }, "database backups queued");
  }
}

function applyRetention({ database, config, logger }: WorkerDependencies): void {
  const now = new Date();
  const pruned = pruneLogs(database, {
    runtimeLinesPerProject: config.RUNTIME_LOG_RETENTION_LINES,
    deploymentLogRetentionDays: config.DEPLOYMENT_LOG_RETENTION_DAYS,
    now,
  });
  pruneMetricSamples(
    database,
    new Date(now.getTime() - config.METRICS_RETENTION_HOURS * MILLISECONDS_PER_HOUR),
  );
  pruneUptimeChecks(database, now);
  logger.info(pruned, "retention applied");
}

/**
 * Starts the clock-based duties: scheduled tasks, restart loop rollbacks and uptime checks every minute,
 * health checks every five minutes, domain certificates daily, retention and project database
 * backups every hour, and every day the panel database backup (plus one at startup when the
 * newest backup is a day old) and the cleanup of build cache and orphan images on each server.
 *
 * @param dependencies - Worker dependencies.
 * @param guard - The worker's duty wrapper.
 * @returns The cron jobs, for the worker to stop on shutdown.
 */
export function startScheduledDuties(
  dependencies: WorkerDependencies,
  guard: Guard,
): Bun.CronJob[] {
  void guard("backup", async () => await backupDatabaseIfDue(dependencies))();
  return [
    Bun.cron(
      "* * * * *",
      guard("scheduler", () => scheduleTasks(dependencies)),
    ),
    Bun.cron(
      "* * * * *",
      guard("auto-rollback", async () => await rollBackRestartLoops(dependencies)),
    ),
    Bun.cron(
      "* * * * *",
      guard("uptime", async () => await checkUptime(dependencies)),
    ),
    Bun.cron(
      "17 * * * *",
      guard("retention", () => applyRetention(dependencies)),
    ),
    // Daily at 06:15 UTC; certificates change rarely and a warning comes two weeks early.
    Bun.cron(
      "15 6 * * *",
      guard("certificates", async () => await checkCertificates(dependencies)),
    ),
    Bun.cron(
      "*/5 * * * *",
      guard("health", async () => await checkHealth(dependencies)),
    ),
    // Hourly, so a database gets its daily backup within an hour of being due.
    Bun.cron(
      "47 * * * *",
      guard("database-backups", () => queueDatabaseBackups(dependencies)),
    ),
    // Daily at 04:30 UTC, after the panel backup, to free disk on every server.
    Bun.cron(
      "30 4 * * *",
      guard("server-cleanup", async () => await cleanUpServers(dependencies)),
      { tz: "UTC" },
    ),
    // Daily at 03:30 UTC, when panels are usually quiet.
    Bun.cron(
      "30 3 * * *",
      guard("backup", async () => await runDatabaseBackup(dependencies)),
      { tz: "UTC" },
    ),
  ];
}
