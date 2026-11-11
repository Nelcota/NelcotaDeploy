import type { Logger } from "pino";

import {
  claimNextJob,
  assertJobOwnership,
  completeJob,
  failJob,
  type Job,
  JobLeaseLostError,
  recoverExpiredJobs,
  releaseWorkerJobs,
  renewJobLeases,
} from "@/jobs";
import { recordWorkerHeartbeat } from "@/monitoring";

import { dispatchJob, jobHandlerFor } from "./job-dispatch";
import { handleRecoveredJobs } from "./job-recovery";
import { requeueFailedCleanups } from "./maintenance/cleanup-recovery";
import { finishProjectMoves } from "./maintenance/project-moves";
import { recoverFailedResources } from "./maintenance/resource-recovery";
import { startScheduledDuties } from "./maintenance/scheduled-duties";
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
type ActiveJob = {
  readonly job: Job;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
};

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
  readonly #active = new Map<string, ActiveJob>();
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
    database.transaction(
      () => {
        handleRecoveredJobs(database, logger, releaseWorkerJobs(database, workerId));
        recoverFailedResources(database, logger);
      },
      { behavior: "immediate" },
    );
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
      const controller = new AbortController();
      const signal = AbortSignal.any([this.#abortJobs.signal, controller.signal]);
      const promise = this.#execute(job, signal).finally(() => this.#active.delete(job.id));
      this.#active.set(job.id, { job, controller, promise });
    }
  }

  async #execute(job: Job, signal: AbortSignal): Promise<void> {
    const { database, logger } = this.#dependencies;
    try {
      await dispatchJob(this.#dependencies, job, {
        signal,
        assertOwnership: () => assertJobOwnership(database, job),
        refreshContainers: async (serverId) => await this.#fleet.refreshServer(serverId),
      });
      if (completeJob(database, job) === false) {
        throw new JobLeaseLostError(job.id);
      }
      logger.info({ jobId: job.id, kind: job.kind }, "job finished");
    } catch (error) {
      if (error instanceof JobLeaseLostError || signal.reason instanceof JobLeaseLostError) {
        logger.warn({ jobId: job.id }, "job lease lost; the previous attempt stopped");
        return;
      }
      this.#recordFailure(job, error);
    }
  }

  #recordFailure(job: Job, error: unknown): void {
    const { database, logger } = this.#dependencies;
    const message = error instanceof Error ? error.message : String(error);
    const outcome = database.transaction(
      (transaction) => {
        const result = failJob(transaction, job, {
          errorMessage: message,
          retryable: this.#abortJobs.signal.aborted || jobHandlerFor(job.kind).retriesOnFailure,
        });
        if (result !== "lost") {
          handleRecoveredJobs(database, logger, [
            {
              id: job.id,
              kind: job.kind,
              deploymentId: job.deploymentId,
              taskExecutionId: job.taskExecutionId,
              payload: job.payload,
              reason: message,
              outcome: result,
            },
          ]);
        }
        return result;
      },
      { behavior: "immediate" },
    );
    logger.error({ jobId: job.id, kind: job.kind, err: error, outcome }, "job failed");
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
    every(MOVE_CHECK_INTERVAL_IN_MS, "cleanup-recovery", () => {
      requeueFailedCleanups(this.#dependencies.database);
    });
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
    this.#timers.push(...startScheduledDuties(this.#dependencies, guard));
  }

  #heartbeat(): void {
    const { database, workerId } = this.#dependencies;
    recordWorkerHeartbeat(database, {
      workerId,
      startedAt: this.#startedAt,
      dockerAvailable: this.#fleet.applicationsReady(),
      dockerVersion: this.#fleet.localDockerVersion,
    });
    const active = [...this.#active.values()];
    const renewed = renewJobLeases(database, { leases: active.map((entry) => entry.job) });
    for (const entry of active) {
      if (renewed.has(entry.job.id) === false) {
        entry.controller.abort(new JobLeaseLostError(entry.job.id));
      }
    }
    database.transaction(
      () => {
        handleRecoveredJobs(database, this.#dependencies.logger, recoverExpiredJobs(database));
      },
      { behavior: "immediate" },
    );
  }

  async #drain(): Promise<void> {
    // Other workers must not reclaim jobs while this worker is still draining them.
    using _leaseRenewal = {
      timer: setInterval(() => this.#heartbeat(), HEARTBEAT_INTERVAL_IN_MS),
      [Symbol.dispose]() {
        clearInterval(this.timer);
      },
    };
    for (const timer of this.#timers) {
      if (typeof timer === "object" && "stop" in timer) {
        timer.stop();
      } else {
        clearInterval(timer);
      }
    }
    const pending = [...this.#active.values()].map((entry) => entry.promise);
    await Promise.race([Promise.allSettled(pending), Bun.sleep(SHUTDOWN_GRACE_IN_MS)]);
    this.#abortJobs.abort();
    await Promise.race([Promise.allSettled(pending), Bun.sleep(ABORT_GRACE_IN_MS)]);
    this.#fleet[Symbol.dispose]();
    this.#dependencies.hosts[Symbol.dispose]();
    this.#dependencies.logger.info({ unfinished: this.#active.size }, "worker stopped");
  }
}
