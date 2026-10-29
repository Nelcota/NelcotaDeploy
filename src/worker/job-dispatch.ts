import type { AppConfig } from "@/config";
import { getDeployment, isContainerAction } from "@/deployments";
import type { Job } from "@/jobs";

import { runContainerAction, runProjectCleanup } from "./container-action-runner";
import type { DeployRunnerConfig } from "./deploy/deploy-context";
import { runDeployment } from "./deploy/deploy-runner";
import { runTaskExecution } from "./task-runner";
import type { WorkerDependencies } from "./worker.types";

/** What a job needs from the worker running it. */
export type JobRun = {
  /** Aborted only when the job outlives the shutdown grace period. */
  readonly signal: AbortSignal;
  /** Updates the observed container state after a job changed it. */
  readonly refreshContainers: () => Promise<void>;
};

function deployRunnerConfig(config: AppConfig): DeployRunnerConfig {
  return {
    workspaceDir: config.WORKSPACE_DIR,
    network: config.DOCKER_NETWORK,
    buildTimeoutInSeconds: config.BUILD_TIMEOUT_SECONDS,
    healthCheckTimeoutInSeconds: config.HEALTH_CHECK_TIMEOUT_SECONDS,
    imagesKeptPerProject: config.IMAGES_KEPT_PER_PROJECT,
    traefik: {
      enabled: config.TRAEFIK_ENABLED,
      httpEntrypoint: config.TRAEFIK_HTTP_ENTRYPOINT,
      httpsEntrypoint: config.TRAEFIK_HTTPS_ENTRYPOINT,
      certResolver: config.TRAEFIK_CERT_RESOLVER,
    },
  };
}

function requireId(id: string | null, job: Job): string {
  if (id == null) {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its target id`);
  }
  return id;
}

async function runDeployJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: JobRun,
): Promise<void> {
  const deploymentId = requireId(job.deploymentId, job);
  const status = await runDeployment(
    { ...dependencies, config: deployRunnerConfig(dependencies.config) },
    deploymentId,
    run.signal,
  );
  await run.refreshContainers();
  if (status === "failed") {
    throw new Error(
      getDeployment(dependencies.database, deploymentId).errorMessage ?? "Deployment failed",
    );
  }
}

async function runContainerActionJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: JobRun,
): Promise<void> {
  const action = job.payload["action"];
  if (isContainerAction(action) === false) {
    throw new Error(`Job ${job.id} has an invalid container action`);
  }
  await runContainerAction(dependencies.database, dependencies.docker, {
    deploymentId: requireId(job.deploymentId, job),
    action,
  });
  await run.refreshContainers();
}

async function runTaskJob(dependencies: WorkerDependencies, job: Job, run: JobRun): Promise<void> {
  const status = await runTaskExecution(
    dependencies,
    requireId(job.taskExecutionId, job),
    run.signal,
  );
  if (status === "failed") {
    throw new Error("Task execution failed");
  }
}

async function runProjectCleanupJob(dependencies: WorkerDependencies, job: Job): Promise<void> {
  const removed = await runProjectCleanup(
    dependencies.database,
    dependencies.docker,
    job.projectId,
  );
  dependencies.logger.info({ projectId: job.projectId, ...removed }, "project deleted");
}

/**
 * Runs one claimed job with the runner for its kind.
 *
 * @param dependencies - Worker dependencies.
 * @param job - Claimed job.
 * @param run - Abort signal and container refresh from the worker.
 * @throws {Error} When the job failed, so the queue records the failure.
 */
export async function dispatchJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: JobRun,
): Promise<void> {
  switch (job.kind) {
    case "deploy": {
      await runDeployJob(dependencies, job, run);
      return;
    }
    case "container_action": {
      await runContainerActionJob(dependencies, job, run);
      return;
    }
    case "task_run": {
      await runTaskJob(dependencies, job, run);
      return;
    }
    case "project_cleanup": {
      await runProjectCleanupJob(dependencies, job);
    }
  }
}
