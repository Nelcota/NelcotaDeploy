import type { Logger } from "pino";

import type { Database } from "@/db";
import { getDeployment, isTerminalStatus, transitionDeployment } from "@/deployments";
import type { RecoveredJob } from "@/jobs";
import { appendDeploymentLogs } from "@/logs";
import { failTaskExecutions } from "@/tasks";

function recoverDeployment(
  database: Database,
  deploymentId: string,
  outcome: RecoveredJob["outcome"],
): void {
  const deployment = getDeployment(database, deploymentId);
  if (isTerminalStatus(deployment.status)) {
    return;
  }
  const message =
    outcome === "requeued"
      ? "The worker stopped during this deployment; it will run again"
      : "The worker stopped during this deployment";
  appendDeploymentLogs(database, deploymentId, [{ stream: "system", level: "warn", message }]);
  if (deployment.status !== "queued") {
    transitionDeployment(database, deploymentId, {
      to: outcome === "requeued" ? "queued" : "failed",
      errorMessage: outcome === "requeued" ? null : message,
    });
  }
}

/**
 * Brings deployments and task executions of jobs interrupted by a crash back in line with
 * what the queue decided for them.
 *
 * @param database - Database.
 * @param logger - Worker logger.
 * @param recovered - Jobs the queue requeued or failed.
 */
export function handleRecoveredJobs(
  database: Database,
  logger: Logger,
  recovered: readonly RecoveredJob[],
): void {
  const failedExecutions: string[] = [];
  for (const job of recovered) {
    logger.warn(
      { jobId: job.id, kind: job.kind, outcome: job.outcome },
      "recovered interrupted job",
    );
    if (job.taskExecutionId != null && job.outcome === "failed") {
      failedExecutions.push(job.taskExecutionId);
    }
    if (job.deploymentId != null && job.kind === "deploy") {
      recoverDeployment(database, job.deploymentId, job.outcome);
    }
  }
  failTaskExecutions(database, failedExecutions, "The worker stopped while the task was running");
}
