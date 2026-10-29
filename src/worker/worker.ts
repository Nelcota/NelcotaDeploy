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

import { dispatchJob } from "./job-dispatch";
import { handleRecoveredJobs } from "./job-recovery";
import { finishProjectMoves } from "./project-moves";
import { ServerFleet } from "./servers/server-fleet";
import type { WorkerDependencies } from "./worker.types";

const IDLE_POLL_INTERVAL_IN_MS = 1000;
const HEARTBEAT_INTERVAL_IN_MS = 10_000;
const SERVER_CHECK_INTERVAL_IN_MS = 10_000;
// Docker events refresh containers as they change; this only catches anything missed.
const CONTAINER_REFRESH_INTERVAL_IN_MS = 60_000;
const MOVE_CHECK_INTERVAL_IN_MS = 60_000;
const SHUTDOWN_GRACE_IN_MS = 90_000;
const ABORT_GRACE_IN_MS = 10_000;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 3_600_000;

type PeriodicDuty = () => Promise<void> | void;

// A run that outlasts its interval (an unreachable server waiting for its timeout) is not
// started again until it finishes.
function guardDuty(logger: Logger, name: string, duty: PeriodicDuty): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await duty();
    } catch (error) {
      logger.error({ err: error, duty: name }, "periodic duty failed");
    } finally {
      running = false;
    }
  };
}

/**
 * Consumes the persistent job queue and runs the periodic duties: heartbeats, lease
 * renewal, crash recovery, server checks, container observation and metrics on every ready
 * server, task scheduling and retention.
 */
export class Worker {
  readonly #dependencies: WorkerDependencies;
  readonly #startedAt = new Date().toISOString();
  readonly #active = new Map<string, Promise<void>>();
  readonly #shutdown = new AbortController();
  /** Aborted only when running jobs outlive the shutdown grace period. */
  readonly #abortJobs = new AbortController();
  readonly #timers: (ReturnType<typeof setInterval> | Bun.CronJob)[] = [];
  readonly #fleet: ServerFleet;

  constructor(dependencies: WorkerDependencies) {
    this.#dependencies = dependencies;
    this.#fleet = new ServerFleet(dependencies);
  }

  /**
   * Recovers jobs left by a previous run, starts periodic duties and processes jobs until
   * {@link Worker.stop} is called.
   */
  async run(): Promise<void> {
    const { database, workerId, logger } = this.#dependencies;
    handleRecoveredJobs(database, logger, releaseWorkerJobs(database, workerId));
    this.#fleet.check();
    this.#heartbeat();
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
        refreshContainers: async (serverId) => await this.#fleet.refreshServer(serverId),
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
    every(HEARTBEAT_INTERVAL_IN_MS, "heartbeat", () => this.#heartbeat());
    every(SERVER_CHECK_INTERVAL_IN_MS, "servers", () => this.#fleet.check());
    every(
      MOVE_CHECK_INTERVAL_IN_MS,
      "moves",
      async () => await finishProjectMoves(this.#dependencies),
    );
    const refreshContainers = guard(
      "containers",
      async () => await this.#fleet.refreshContainers(),
    );
    this.#fleet.onServerReady(() => void refreshContainers());
    every(CONTAINER_REFRESH_INTERVAL_IN_MS, "containers", refreshContainers);
    every(
      config.METRICS_INTERVAL_SECONDS * MILLISECONDS_PER_SECOND,
      "metrics",
      async () => await this.#fleet.collectMetrics(),
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

  #heartbeat(): void {
    const { database, workerId } = this.#dependencies;
    recordWorkerHeartbeat(database, {
      workerId,
      startedAt: this.#startedAt,
      dockerAvailable: this.#fleet.applicationsReady(),
      dockerVersion: this.#fleet.localDockerVersion,
    });
    renewJobLeases(database, { workerId, jobIds: [...this.#active.keys()] });
    handleRecoveredJobs(database, this.#dependencies.logger, recoverExpiredJobs(database));
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
    this.#fleet[Symbol.dispose]();
    this.#dependencies.hosts[Symbol.dispose]();
    this.#dependencies.logger.info({ unfinished: this.#active.size }, "worker stopped");
  }
}
