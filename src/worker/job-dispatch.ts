import type { AppConfig } from "@/config";
import {
  applyRuntimeChanges,
  getDeployment,
  isContainerAction,
  isTerminalStatus,
  listDeploymentServerIds,
  transitionDeployment,
} from "@/deployments";
import type { Job } from "@/jobs";

import {
  runContainerAction,
  runProjectCleanup,
  runVolumeDeleteJob,
} from "./container-action-runner";
import type { DeployRunnerConfig, DeployRunnerDependencies } from "./deploy/deploy-context";
import { runDeployment } from "./deploy/deploy-runner";
import {
  notifyFailedDeployment,
  reportDeploymentStatus,
} from "./notifications/deployment-notifications";
import type { ServerHost } from "./server-host";
import { runTaskExecution } from "./task-runner";
import type { WorkerDependencies } from "./worker.types";

// Traefik applies provider changes after a 2 s throttle; a little more lets it switch to the
// new container before the old one stops.
const ROUTING_SETTLE_IN_MS = 3000;

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
    routingSettleInMs: ROUTING_SETTLE_IN_MS,
    traefik: {
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
    routes: host.routes,
  };
}

function requireId(id: string | null, job: Job): string {
  if (id == null) {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its target id`);
  }
  return id;
}

/**
 * Returns the host of the server a deployment was queued for. When that server is gone, the
 * deployment fails with a clear message instead of staying queued forever.
 */
function hostOfDeployment(dependencies: WorkerDependencies, deploymentId: string): ServerHost {
  const { database } = dependencies;
  const deployment = getDeployment(database, deploymentId);
  try {
    return dependencies.hosts.hostOf(database, deployment.serverId);
  } catch (error) {
    if (isTerminalStatus(deployment.status) === false) {
      transitionDeployment(database, deploymentId, {
        to: "failed",
        errorMessage: `The server ${deployment.serverId} of this deployment no longer exists`,
      });
    }
    throw error;
  }
}

const AUTO_APPLY_ACTOR = { type: "system", label: "auto-apply" } as const;
/** How each outcome of a deploy job shows on its commit. */
const FINAL_COMMIT_STATES = {
  succeeded: "success",
  failed: "failure",
  cancelled: "error",
} as const;

async function runDeployJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: JobRun,
): Promise<void> {
  const deploymentId = requireId(job.deploymentId, job);
  // The server was chosen when the deployment was queued; a retry after a crash stays there.
  const host = hostOfDeployment(dependencies, deploymentId);
  await reportDeploymentStatus(dependencies, deploymentId, "pending");
  const status = await runDeployment(
    deployRunnerDependencies(dependencies, host),
    deploymentId,
    run.signal,
  );
  await run.refreshContainers(host.serverId);
  // A skipped job found the deployment already finished; its status was published then.
  if (status !== "skipped") {
    await reportDeploymentStatus(dependencies, deploymentId, FINAL_COMMIT_STATES[status]);
  }
  if (status === "failed") {
    const deployment = getDeployment(dependencies.database, deploymentId);
    await notifyFailedDeployment(dependencies, deployment);
    throw new Error(deployment.errorMessage ?? "Deployment failed");
  }
  if (status === "succeeded") {
    // Variables or domains saved while this deploy ran were left for now; apply them. Only after
    // a success, so a configuration that keeps failing is never retried in a loop.
    applyRuntimeChanges(
      dependencies.database,
      getDeployment(dependencies.database, deploymentId).projectId,
      {
        actor: AUTO_APPLY_ACTOR,
        triggeredByUserId: null,
      },
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
  const { failures, ...removed } = await runProjectCleanup(
    dependencies.database,
    hosts,
    job.projectId,
  );
  for (const failure of failures) {
    dependencies.logger.warn(
      { err: failure, projectId: job.projectId },
      "server unreachable during project deletion; its containers go when it is back",
    );
  }
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
      return;
    }
    case "volume_delete": {
      await runVolumeDeleteJob(dependencies, job);
    }
  }
}
