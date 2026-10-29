import type { AppConfig } from "@/config";
import { getDeployment, isContainerAction, listDeploymentServerIds } from "@/deployments";
import type { Job } from "@/jobs";

import { runContainerAction, runProjectCleanup } from "./container-action-runner";
import type { DeployRunnerConfig, DeployRunnerDependencies } from "./deploy/deploy-context";
import { runDeployment } from "./deploy/deploy-runner";
import type { ServerHost } from "./servers/server-hosts";
import { runTaskExecution } from "./task-runner";
import type { WorkerDependencies } from "./worker.types";

/** What a job needs from the worker running it. */
export type JobRun = {
  /** Aborted only when the job outlives the shutdown grace period. */
  readonly signal: AbortSignal;
  /** Updates the observed container state of a server after a job changed it. */
  readonly refreshContainers: (serverId: string) => Promise<void>;
};

function deployRunnerConfig(config: AppConfig, host: ServerHost): DeployRunnerConfig {
  return {
    workspaceDir: host.workspaceDir,
    network: config.DOCKER_NETWORK,
    buildTimeoutInSeconds: config.BUILD_TIMEOUT_SECONDS,
    healthCheckTimeoutInSeconds: config.HEALTH_CHECK_TIMEOUT_SECONDS,
    imagesKeptPerProject: config.IMAGES_KEPT_PER_PROJECT,
    traefik: {
      // Servers the platform set up always run its proxy; the local one only with Compose.
      enabled: config.TRAEFIK_ENABLED || host.platformProxy,
      httpEntrypoint: config.TRAEFIK_HTTP_ENTRYPOINT,
      httpsEntrypoint: config.TRAEFIK_HTTPS_ENTRYPOINT,
      certResolver: config.TRAEFIK_CERT_RESOLVER,
      compress: host.platformProxy,
    },
  };
}

function deployRunnerDependencies(
  dependencies: WorkerDependencies,
  host: ServerHost,
): DeployRunnerDependencies {
  return {
    database: dependencies.database,
    runner: host.runner,
    docker: host.docker,
    git: host.git,
    probes: host.probes,
    secretBox: dependencies.secretBox,
    config: deployRunnerConfig(dependencies.config, host),
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
  // The server was chosen when the deployment was queued; a retry after a crash stays there.
  const { serverId } = getDeployment(dependencies.database, deploymentId);
  const host = dependencies.hosts.hostOf(dependencies.database, serverId);
  const status = await runDeployment(
    deployRunnerDependencies(dependencies, host),
    deploymentId,
    run.signal,
  );
  await run.refreshContainers(host.serverId);
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
  const deployment = getDeployment(dependencies.database, requireId(job.deploymentId, job));
  const host = dependencies.hosts.hostOf(dependencies.database, deployment.serverId);
  await runContainerAction(dependencies.database, host.docker, {
    deploymentId: deployment.id,
    action,
  });
  await run.refreshContainers(host.serverId);
}

async function runTaskJob(dependencies: WorkerDependencies, job: Job, run: JobRun): Promise<void> {
  const status = await runTaskExecution(
    {
      database: dependencies.database,
      secretBox: dependencies.secretBox,
      dockerOf: (serverId) => dependencies.hosts.hostOf(dependencies.database, serverId).docker,
    },
    requireId(job.taskExecutionId, job),
    run.signal,
  );
  if (status === "failed") {
    throw new Error("Task execution failed");
  }
}

async function runProjectCleanupJob(dependencies: WorkerDependencies, job: Job): Promise<void> {
  const serverIds = listDeploymentServerIds(dependencies.database, job.projectId);
  const hosts = dependencies.hosts.hostsOf(dependencies.database, serverIds);
  const removed = await runProjectCleanup(
    dependencies.database,
    hosts.map((host) => host.docker),
    job.projectId,
  );
  dependencies.logger.info({ projectId: job.projectId, ...removed }, "project deleted");
}

/**
 * Runs one claimed job with the runner for its kind, on the server it belongs to.
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
