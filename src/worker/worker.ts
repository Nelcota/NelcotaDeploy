import type { Logger } from "pino";

import {
  claimNextJob,
  completeJob,
  failJob,
  type Job,
  recoverExpiredJobs,
  releaseWorkerJobs,
  renewJobLeases,
} from "@/jobs";
import { pruneLogs } from "@/logs";
import { pruneMetricSamples, recordWorkerHeartbeat } from "@/monitoring";
import { scheduleDueTasks } from "@/tasks";

import { ContainerObserver } from "./container-observer";
import { HostSampler } from "./host-sampler";
import { dispatchJob } from "./job-dispatch";
import { handleRecoveredJobs } from "./job-recovery";
import type { WorkerDependencies } from "./worker.types";

const IDLE_POLL_INTERVAL_IN_MS = 1000;
const HEARTBEAT_INTERVAL_IN_MS = 10_000;
const CONTAINER_REFRESH_INTERVAL_IN_MS = 10_000;
const SHUTDOWN_GRACE_IN_MS = 90_000;
const ABORT_GRACE_IN_MS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 3_600_000;

type PeriodicDuty = () => Promise<void> | void;

function guardDuty(logger: Logger, name: string, duty: PeriodicDuty): () => Promise<void> {
  return async () => {
    try {
      await duty();
    } catch (error) {
      logger.error({ err: error, duty: name }, "periodic duty failed");
    }
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
  readonly #hostSampler = new HostSampler();
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
    handleRecoveredJobs(database, logger, releaseWorkerJobs(database, workerId));
    await this.#heartbeat();
    this.#startPeriodicDuties();
    logger.info(
      { workerId, concurrency: this.#dependencies.config.WORKER_CONCURRENCY },
      "worker started",
    );
    await this.#claimJobsUntilShutdown();
    await this.#drain();
  }

  /** Stops claiming jobs; running jobs get a grace period before they are aborted. */
  stop(): void {
    this.#shutdown.abort();
  }

  async #claimJobsUntilShutdown(): Promise<void> {
    const shutdown = Promise.withResolvers<void>();
    this.#shutdown.signal.addEventListener("abort", () => shutdown.resolve(), { once: true });
    if (this.#shutdown.signal.aborted) {
      return;
    }
    this.#claimAvailableJobs();
    this.#timers.push(setInterval(() => this.#claimAvailableJobs(), IDLE_POLL_INTERVAL_IN_MS));
    await shutdown.promise;
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
      await dispatchJob(this.#dependencies, job, {
        signal: this.#abortJobs.signal,
        refreshContainers: async () => await this.#refreshContainers(),
      });
      completeJob(database, job.id);
      logger.info({ jobId: job.id, kind: job.kind }, "job finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only a shutdown mid-job is worth retrying; other failures would fail the same way.
      const outcome = failJob(database, job.id, {
        errorMessage: message,
        retryable: this.#abortJobs.signal.aborted,
      });
      logger.error({ jobId: job.id, kind: job.kind, err: error, outcome }, "job failed");
    }
  }

  #startPeriodicDuties(): void {
    const { config, logger } = this.#dependencies;
    const guard = (name: string, duty: PeriodicDuty) => guardDuty(logger, name, duty);
    const every = (intervalInMs: number, name: string, duty: PeriodicDuty) => {
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
    renewJobLeases(database, { workerId, jobIds: [...this.#active.keys()] });
    handleRecoveredJobs(database, this.#dependencies.logger, recoverExpiredJobs(database));
  }

  async #refreshContainers(): Promise<void> {
    if (this.#dockerVersion == null) {
      return;
    }
    await this.#observer.refresh();
  }

  async #collectMetrics(): Promise<void> {
    const { database, config } = this.#dependencies;
    await this.#hostSampler.sample(database, config.WORKSPACE_DIR);
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
