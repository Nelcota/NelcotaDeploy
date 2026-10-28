import type { Logger } from "pino";

import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import {
  getDeployment,
  isContainerAction,
  isTerminalStatus,
  transitionDeployment,
} from "@/deployments";
import type { DockerEngine } from "@/docker";
import type { GitClient } from "@/git";
import {
  claimNextJob,
  completeJob,
  failJob,
  type Job,
  type RecoveredJob,
  recoverExpiredJobs,
  releaseWorkerJobs,
  renewJobLeases,
} from "@/jobs";
import { appendDeploymentLogs, pruneLogs } from "@/logs";
import {
  cpuPercentBetween,
  type CpuTimes,
  pruneMetricSamples,
  readCpuTimes,
  readDiskUsage,
  readMemoryUsage,
  recordHostSample,
  recordWorkerHeartbeat,
} from "@/monitoring";
import type { SecretBox } from "@/secrets";
import { failTaskExecutions, scheduleDueTasks } from "@/tasks";

import { runContainerAction, runProjectCleanup } from "./container-action-runner";
import { ContainerObserver } from "./container-observer";
import { type DeployRunnerConfig, runDeployment } from "./deploy-runner";
import { runTaskExecution } from "./task-runner";

const IDLE_POLL_INTERVAL_IN_MS = 1000;
const HEARTBEAT_INTERVAL_IN_MS = 10_000;
const CONTAINER_REFRESH_INTERVAL_IN_MS = 10_000;
const SHUTDOWN_GRACE_IN_MS = 90_000;
const ABORT_GRACE_IN_MS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 3_600_000;

/** Everything the worker needs. Tests pass in-memory doubles for Docker and git. */
export type WorkerDependencies = {
  readonly workerId: string;
  readonly database: Database;
  readonly docker: DockerEngine;
  readonly git: Pick<GitClient, "cloneAndCheckout">;
  readonly secretBox: SecretBox;
  readonly config: AppConfig;
  readonly logger: Logger;
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

/**
 * Consumes the persistent job queue and runs the periodic duties: heartbeats, lease
 * renewal, crash recovery, container observation, metrics, task scheduling and retention.
 */
export class Worker {
  readonly #dependencies: WorkerDependencies;
  readonly #startedAt = new Date().toISOString();
  readonly #active = new Map<string, Promise<void>>();
  readonly #shutdown = new AbortController();
  /** Aborted only when running jobs outlive the shutdown grace period. */
  readonly #abortJobs = new AbortController();
  readonly #observer: ContainerObserver;
  readonly #timers: (ReturnType<typeof setInterval> | Bun.CronJob)[] = [];
  #previousCpu: CpuTimes | null = null;
  #dockerVersion: string | null = null;

  constructor(dependencies: WorkerDependencies) {
    this.#dependencies = dependencies;
    this.#observer = new ContainerObserver(dependencies);
  }

  /**
   * Recovers jobs left by a previous run, starts periodic duties and processes jobs until
   * {@link Worker.stop} is called.
   */
  async run(): Promise<void> {
    const { database, workerId, logger } = this.#dependencies;
    this.#handleRecovered(releaseWorkerJobs(database, workerId));
    await this.#heartbeat();
    this.#startPeriodicDuties();
    logger.info(
      { workerId, concurrency: this.#dependencies.config.WORKER_CONCURRENCY },
      "worker started",
    );

    while (this.#shutdown.signal.aborted === false) {
      this.#claimAvailableJobs();
      await Bun.sleep(IDLE_POLL_INTERVAL_IN_MS);
    }
    await this.#drain();
  }

  /** Stops claiming jobs; running jobs get a grace period before they are aborted. */
  stop(): void {
    this.#shutdown.abort();
  }

  #claimAvailableJobs(): void {
    const { database, workerId, config, logger } = this.#dependencies;
    while (this.#active.size < config.WORKER_CONCURRENCY) {
      const job = claimNextJob(database, workerId);
      if (job == null) {
        return;
      }
      logger.info({ jobId: job.id, kind: job.kind, projectId: job.projectId }, "job claimed");
      const execution = this.#execute(job).finally(() => this.#active.delete(job.id));
      this.#active.set(job.id, execution);
    }
  }

  async #execute(job: Job): Promise<void> {
    const { database, logger } = this.#dependencies;
    try {
      await this.#dispatch(job);
      completeJob(database, job.id);
      logger.info({ jobId: job.id, kind: job.kind }, "job finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only a shutdown mid-job is worth retrying; other failures would fail the same way.
      const outcome = failJob(database, job.id, message, {
        retryable: this.#abortJobs.signal.aborted,
      });
      logger.error({ jobId: job.id, kind: job.kind, err: error, outcome }, "job failed");
    }
  }

  async #dispatch(job: Job): Promise<void> {
    const dependencies = this.#dependencies;
    const signal = this.#abortJobs.signal;
    switch (job.kind) {
      case "deploy": {
        const deploymentId = requireId(job.deploymentId, job);
        const status = await runDeployment(
          { ...dependencies, config: deployRunnerConfig(dependencies.config) },
          deploymentId,
          signal,
        );
        await this.#refreshContainers();
        if (status === "failed") {
          throw new Error(
            getDeployment(dependencies.database, deploymentId).errorMessage ?? "Deployment failed",
          );
        }
        return;
      }
      case "container_action": {
        const action = job.payload["action"];
        if (isContainerAction(action) === false) {
          throw new Error(`Job ${job.id} has an invalid container action`);
        }
        await runContainerAction(
          dependencies.database,
          dependencies.docker,
          requireId(job.deploymentId, job),
          action,
        );
        await this.#refreshContainers();
        return;
      }
      case "task_run": {
        const status = await runTaskExecution(
          dependencies,
          requireId(job.taskExecutionId, job),
          signal,
        );
        if (status === "failed") {
          throw new Error("Task execution failed");
        }
        return;
      }
      case "project_cleanup": {
        const removed = await runProjectCleanup(
          dependencies.database,
          dependencies.docker,
          job.projectId,
        );
        dependencies.logger.info({ projectId: job.projectId, ...removed }, "project deleted");
      }
    }
  }

  #handleRecovered(recovered: readonly RecoveredJob[]): void {
    const { database, logger } = this.#dependencies;
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

  #startPeriodicDuties(): void {
    const { config, logger } = this.#dependencies;
    const guard = (name: string, duty: () => Promise<void> | void) => async () => {
      try {
        await duty();
      } catch (error) {
        logger.error({ err: error, duty: name }, "periodic duty failed");
      }
    };
    const every = (intervalInMs: number, name: string, duty: () => Promise<void> | void) => {
      const run = guard(name, duty);
      void run();
      this.#timers.push(setInterval(() => void run(), intervalInMs));
    };
    every(HEARTBEAT_INTERVAL_IN_MS, "heartbeat", async () => await this.#heartbeat());
    every(
      CONTAINER_REFRESH_INTERVAL_IN_MS,
      "containers",
      async () => await this.#refreshContainers(),
    );
    every(
      config.METRICS_INTERVAL_SECONDS * MILLISECONDS_PER_SECOND,
      "metrics",
      async () => await this.#collectMetrics(),
    );
    this.#timers.push(
      Bun.cron(
        "* * * * *",
        guard("scheduler", () => this.#scheduleTasks()),
      ),
    );
    this.#timers.push(
      Bun.cron(
        "17 * * * *",
        guard("retention", () => this.#applyRetention()),
      ),
    );
  }

  async #heartbeat(): Promise<void> {
    const { database, docker, workerId } = this.#dependencies;
    this.#dockerVersion = await docker.serverVersion();
    recordWorkerHeartbeat(database, {
      workerId,
      startedAt: this.#startedAt,
      dockerAvailable: this.#dockerVersion != null,
      dockerVersion: this.#dockerVersion,
    });
    renewJobLeases(database, workerId, [...this.#active.keys()]);
    this.#handleRecovered(recoverExpiredJobs(database));
  }

  async #refreshContainers(): Promise<void> {
    if (this.#dockerVersion == null) {
      return;
    }
    await this.#observer.refresh();
  }

  async #collectMetrics(): Promise<void> {
    const { database, config } = this.#dependencies;
    const [cpu, memory, disk] = await Promise.all([
      readCpuTimes(),
      readMemoryUsage(),
      readDiskUsage(config.WORKSPACE_DIR),
    ]);
    const cpuPercent =
      this.#previousCpu == null || cpu == null ? null : cpuPercentBetween(this.#previousCpu, cpu);
    this.#previousCpu = cpu;
    recordHostSample(database, {
      cpuPercent,
      memoryUsedBytes: memory?.usedBytes ?? null,
      memoryTotalBytes: memory?.totalBytes ?? null,
      diskUsedBytes: disk?.usedBytes ?? null,
      diskTotalBytes: disk?.totalBytes ?? null,
    });
    if (this.#dockerVersion != null) {
      await this.#observer.sampleMetrics();
    }
  }

  #scheduleTasks(): void {
    const { database, config, logger } = this.#dependencies;
    const queued = scheduleDueTasks(database, new Date(), config.SCHEDULE_TIME_ZONE);
    if (queued.length > 0) {
      logger.info({ executions: queued.length }, "scheduled tasks queued");
    }
  }

  #applyRetention(): void {
    const { database, config, logger } = this.#dependencies;
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

  async #drain(): Promise<void> {
    for (const timer of this.#timers) {
      if (typeof timer === "object" && "stop" in timer) {
        timer.stop();
      } else {
        clearInterval(timer);
      }
    }
    const pending = [...this.#active.values()];
    await Promise.race([Promise.allSettled(pending), Bun.sleep(SHUTDOWN_GRACE_IN_MS)]);
    this.#abortJobs.abort();
    await Promise.race([Promise.allSettled(pending), Bun.sleep(ABORT_GRACE_IN_MS)]);
    this.#observer[Symbol.dispose]();
    this.#dependencies.logger.info({ unfinished: this.#active.size }, "worker stopped");
  }
}

function requireId(id: string | null, job: Job): string {
  if (id == null) {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its target id`);
  }
  return id;
}

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
    transitionDeployment(database, deploymentId, outcome === "requeued" ? "queued" : "failed", {
      errorMessage: outcome === "requeued" ? null : message,
    });
  }
}
