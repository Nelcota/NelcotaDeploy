import { recoverConsoleJob } from "@/console";
import { isDatabaseJobStranded, recoverDatabaseJob } from "@/databases";
import type { Database } from "@/db";
import {
  applyRuntimeChanges,
  getDeployment,
  isContainerAction,
  isTerminalStatus,
  listDeploymentServerIds,
  transitionDeployment,
} from "@/deployments";
import {
  cancelQueuedDeploymentJobs,
  type Job,
  type JobKind,
  type RecoveredJob,
  requireJobPayloadString,
} from "@/jobs";
import { appendDeploymentLogs } from "@/logs";
import { findProjectServerId, getProject } from "@/projects";
import { failTaskExecutions } from "@/tasks";
import { isVolumeDeletionPending, recoverVolumeDeletion } from "@/volumes";

import {
  runContainerAction,
  runProjectCleanup,
  runVolumeDeleteJob,
} from "./container-action-runner";
import { runDatabaseBackupJob, runDatabaseRestoreJob } from "./databases/database-backup-runner";
import { backupStorage } from "./databases/database-backup-storage";
import { runDatabaseDeleteJob, runDatabaseProvisionJob } from "./databases/database-runner";
import type { DeployRunnerConfig, DeployRunnerDependencies } from "./deploy/deploy-context";
import { runDeployment } from "./deploy/deploy-runner";
import { runPreviewCleanupJob } from "./maintenance/preview-cleanup";
import {
  notifyFailedDeployment,
  reportDeploymentStatus,
} from "./notifications/deployment-notifications";
import type { ServerHost } from "./server-host";
import { runConsoleCommandJob, runTaskExecution } from "./task-runner";
import type { WorkerDependencies } from "./worker.types";

// Traefik applies provider changes after a 2 s throttle; a little more lets it switch to the
// new container before the old one stops.
const ROUTING_SETTLE_IN_MS = 3000;

/** What a job needs from the worker running it. */
export type JobRun = {
  readonly assertOwnership?: () => void;
  /** Aborted only when the job outlives the shutdown grace period. */
  readonly signal: AbortSignal;
  /** Updates the observed container state of a server after a job changed it. */
  readonly refreshContainers: (serverId: string) => Promise<void>;
};

/** Strategy for executing, retrying and recovering one kind of job. */
export type JobHandler = {
  readonly run: (dependencies: WorkerDependencies, job: Job, run: JobRun) => Promise<void>;
  /** Whether a failed attempt is retried even when the worker is not shutting down. */
  readonly retriesOnFailure: boolean;
  /** Brings the job's resource back in line after the queue requeued or failed it. */
  readonly recover: (database: Database, job: RecoveredJob, reason: string) => void;
  /** Whether a failed job still left its resource in a transient state. */
  readonly isStranded: (database: Database, job: Job) => boolean;
};

function deployRunnerConfig(
  config: WorkerDependencies["config"],
  host: ServerHost,
): DeployRunnerConfig {
  return {
    workspaceDir: host.workspaceDir,
    railpackBinary: host.railpackBinary,
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
  run: JobRun,
): DeployRunnerDependencies {
  return {
    assertOwnership: run.assertOwnership ?? (() => undefined),
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
    deployRunnerDependencies(dependencies, host, run),
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
  const deployment = getDeployment(dependencies.database, deploymentId);
  // Variables or domains saved while this deploy ran were left for now; apply them. Only after
  // a production success, so a configuration that keeps failing is never retried in a loop.
  if (status === "succeeded" && deployment.previewId == null) {
    applyRuntimeChanges(dependencies.database, deployment.projectId, {
      actor: AUTO_APPLY_ACTOR,
      triggeredByUserId: null,
    });
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
  // Project controls follow the live deployment when executed, even if a deploy finished first.
  const project = getProject(dependencies.database, job.projectId);
  const deployment = getDeployment(
    dependencies.database,
    requireId(project.currentDeploymentId, job),
  );
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
  const serverId = findProjectServerId(dependencies.database, job.projectId);
  if (serverId == null) {
    return;
  }
  const serverIds = [
    ...new Set([serverId, ...listDeploymentServerIds(dependencies.database, job.projectId)]),
  ];
  const hosts = dependencies.hosts.hostsOf(dependencies.database, serverIds);
  const storage =
    dependencies.offsiteStore == null && dependencies.config.BACKUP_DIR == null
      ? null
      : backupStorage(dependencies);
  const removed = await runProjectCleanup(dependencies.database, hosts, {
    projectId: job.projectId,
    storage,
  });
  dependencies.logger.info({ projectId: job.projectId, ...removed }, "project deleted");
}

async function runConsoleJob(
  dependencies: WorkerDependencies,
  job: Job,
  run: JobRun,
): Promise<void> {
  const commandId = requireJobPayloadString(job, "commandId");
  const status = await runConsoleCommandJob(
    {
      database: dependencies.database,
      secretBox: dependencies.secretBox,
      dockerOf: (serverId) => dependencies.hosts.hostOf(dependencies.database, serverId).docker,
    },
    commandId,
    run.signal,
  );
  if (status === "failed") {
    throw new Error("Console command failed");
  }
}

function recoverDeployment(database: Database, job: RecoveredJob): void {
  const { deploymentId, outcome } = job;
  if (deploymentId == null) {
    return;
  }

  const deployment = getDeployment(database, deploymentId);
  if (isTerminalStatus(deployment.status)) {
    return;
  }

  if (deployment.previewId != null && deployment.cancelRequestedAt != null) {
    database.transaction(
      (transaction) => {
        transitionDeployment(transaction, deploymentId, {
          to: "cancelled",
          errorMessage: "Preview deployment cancelled",
        });
        cancelQueuedDeploymentJobs(transaction, [deploymentId]);
      },
      { behavior: "immediate" },
    );
    return;
  }

  const message =
    outcome === "requeued"
      ? "The worker stopped during this deployment; it will run again"
      : "The worker stopped during this deployment";
  appendDeploymentLogs(database, deploymentId, [{ stream: "system", level: "warn", message }]);
  if (deployment.status !== "queued" || outcome === "failed") {
    transitionDeployment(database, deploymentId, {
      to: outcome === "requeued" ? "queued" : "failed",
      errorMessage: outcome === "requeued" ? null : message,
    });
  }
}

function recoverTaskJob(database: Database, job: RecoveredJob, reason: string): void {
  if (job.taskExecutionId != null && job.outcome === "failed") {
    failTaskExecutions(database, [job.taskExecutionId], reason);
  }
}

function recoverVolumeJob(database: Database, job: RecoveredJob, reason: string): void {
  if (job.outcome !== "failed") {
    return;
  }
  const volumeId = job.payload["volumeId"];
  if (typeof volumeId === "string" && volumeId.trim() !== "") {
    recoverVolumeDeletion(database, volumeId, reason);
  }
}

function isVolumeJobStranded(database: Database, job: Job): boolean {
  const volumeId = job.payload["volumeId"];
  return (
    typeof volumeId === "string" &&
    volumeId.trim() !== "" &&
    isVolumeDeletionPending(database, volumeId)
  );
}

const noRecovery = (): void => undefined;
const neverStranded = (): boolean => false;

const JOB_HANDLERS = {
  deploy: {
    run: runDeployJob,
    retriesOnFailure: false,
    recover: recoverDeployment,
    isStranded: neverStranded,
  },
  container_action: {
    run: runContainerActionJob,
    retriesOnFailure: false,
    recover: noRecovery,
    isStranded: neverStranded,
  },
  task_run: {
    run: runTaskJob,
    retriesOnFailure: false,
    recover: recoverTaskJob,
    isStranded: neverStranded,
  },
  project_cleanup: {
    run: async (dependencies, job) => await runProjectCleanupJob(dependencies, job),
    retriesOnFailure: true,
    recover: noRecovery,
    isStranded: neverStranded,
  },
  volume_delete: {
    run: async (dependencies, job) => await runVolumeDeleteJob(dependencies, job),
    retriesOnFailure: false,
    recover: recoverVolumeJob,
    isStranded: isVolumeJobStranded,
  },
  preview_cleanup: {
    run: async (dependencies, job, run) =>
      await runPreviewCleanupJob(dependencies, job, () => {
        run.signal.throwIfAborted();
        run.assertOwnership?.();
      }),
    retriesOnFailure: true,
    recover: noRecovery,
    isStranded: neverStranded,
  },
  database_provision: {
    run: runDatabaseProvisionJob,
    retriesOnFailure: false,
    recover: recoverDatabaseJob,
    isStranded: isDatabaseJobStranded,
  },
  database_delete: {
    run: runDatabaseDeleteJob,
    retriesOnFailure: false,
    recover: recoverDatabaseJob,
    isStranded: isDatabaseJobStranded,
  },
  database_backup: {
    run: runDatabaseBackupJob,
    retriesOnFailure: false,
    recover: recoverDatabaseJob,
    isStranded: isDatabaseJobStranded,
  },
  database_restore: {
    run: runDatabaseRestoreJob,
    retriesOnFailure: false,
    recover: recoverDatabaseJob,
    isStranded: isDatabaseJobStranded,
  },
  console_command: {
    run: runConsoleJob,
    retriesOnFailure: false,
    recover: (database, job) => recoverConsoleJob(database, job),
    isStranded: neverStranded,
  },
} as const satisfies Record<JobKind, JobHandler>;

/**
 * Returns the handler registered for a job kind.
 *
 * @param kind - Job kind.
 * @returns The handler.
 */
export function jobHandlerFor(kind: JobKind): JobHandler {
  return JOB_HANDLERS[kind];
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
  run.signal.throwIfAborted();
  run.assertOwnership?.();
  await jobHandlerFor(job.kind).run(dependencies, job, run);
}
