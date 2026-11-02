import { queueDueDatabaseBackups } from "@/databases";
import { pruneLogs } from "@/logs";
import { pruneMetricSamples } from "@/monitoring";
import { scheduleDueTasks } from "@/tasks";

import type { WorkerDependencies } from "../worker.types";
import { backupDatabaseIfDue, runDatabaseBackup } from "./database-backup";
import { checkHealth } from "./health-alerts";

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
  logger.info(pruned, "retention applied");
}

/**
 * Starts the clock-based duties: scheduled tasks every minute, health checks every five
 * minutes, retention and project database
 * backups every hour, and the panel database backup every day (plus one at startup when the
 * newest backup is a day old).
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
      "17 * * * *",
      guard("retention", () => applyRetention(dependencies)),
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
    // Daily at 03:30 UTC, when panels are usually quiet.
    Bun.cron(
      "30 3 * * *",
      guard("backup", async () => await runDatabaseBackup(dependencies)),
    ),
  ];
}
