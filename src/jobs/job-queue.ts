import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";

export type Job = typeof tables.jobs.$inferSelect;
type JobKind = Job["kind"];

/** How long a claimed job stays owned by a worker without a heartbeat. */
export const JOB_LEASE_IN_MS = 60_000;
const RETRY_DELAY_IN_MS = 5000;

export type NewJob = {
  readonly kind: JobKind;
  readonly projectId: string;
  readonly deploymentId?: string | null;
  readonly taskExecutionId?: string | null;
  readonly payload?: Record<string, unknown>;
  /** Jobs sharing an active key are deduplicated: the existing job is returned instead. */
  readonly dedupeKey?: string | null;
  /** Total runs allowed, counting retries after a worker crash. */
  readonly maxAttempts?: number;
};

/**
 * Adds a job to the persistent queue.
 *
 * @param database - Database or open transaction.
 * @param job - Job definition.
 * @param now - Current time.
 * @returns The job id and whether a new job was created (false when deduplicated).
 */
export function enqueueJob(
  database: Database | Transaction,
  job: NewJob,
  now: Date = new Date(),
): { id: string; created: boolean } {
  const id = Bun.randomUUIDv7();
  const nowIso = now.toISOString();
  // A skipped or unmatched write returns no row, which `.get()` does not admit in its type.
  const inserted = database
    .insert(tables.jobs)
    .values({
      id,
      kind: job.kind,
      status: "queued",
      projectId: job.projectId,
      deploymentId: job.deploymentId ?? null,
      taskExecutionId: job.taskExecutionId ?? null,
      payload: job.payload ?? {},
      dedupeKey: job.dedupeKey ?? null,
      maxAttempts: job.maxAttempts ?? 1,
      runAfter: nowIso,
      createdAt: nowIso,
    })
    .onConflictDoNothing()
    .returning({ id: tables.jobs.id })
    .all()
    .at(0);
  if (inserted != null) {
    return { id: inserted.id, created: true };
  }
  return { id: findActiveDuplicate(database, job.dedupeKey ?? null), created: false };
}

function findActiveDuplicate(database: Database | Transaction, dedupeKey: string | null): string {
  if (dedupeKey == null) {
    throw new Error("Job insert was ignored without a dedupe key");
  }
  const existing = database
    .select({ id: tables.jobs.id })
    .from(tables.jobs)
    .where(
      and(eq(tables.jobs.dedupeKey, dedupeKey), inArray(tables.jobs.status, ["queued", "running"])),
    )
    .get();
  if (existing == null) {
    throw new Error(`Job insert was ignored without an active duplicate (dedupe key ${dedupeKey})`);
  }
  return existing.id;
}

/**
 * Atomically claims the oldest runnable job whose project has no running job.
 *
 * @remarks
 * The selection and the update run as one SQL statement, and a partial unique index
 * forbids two running jobs per project, so two workers can never take the same job or
 * run two jobs of one project at once.
 *
 * @param database - Database.
 * @param workerId - Identifier of the claiming worker.
 * @param now - Current time.
 * @returns The claimed job, or null when nothing is runnable.
 */
export function claimNextJob(
  database: Database,
  workerId: string,
  now: Date = new Date(),
): Job | null {
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + JOB_LEASE_IN_MS).toISOString();
  // A skipped or unmatched write returns no row, which `.get()` does not admit in its type.
  const claimed = database
    .update(tables.jobs)
    .set({
      status: "running",
      workerId,
      attempts: sql`${tables.jobs.attempts} + 1`,
      startedAt: nowIso,
      leaseExpiresAt,
    })
    .where(
      eq(
        tables.jobs.id,
        sql`(
          SELECT candidate.id FROM jobs AS candidate
          WHERE candidate.status = 'queued'
            AND candidate.run_after <= ${nowIso}
            AND NOT EXISTS (
              SELECT 1 FROM jobs AS running
              WHERE running.project_id = candidate.project_id AND running.status = 'running'
            )
          ORDER BY candidate.created_at, candidate.id
          LIMIT 1
        )`,
      ),
    )
    .returning()
    .all()
    .at(0);
  return claimed ?? null;
}

/**
 * Extends the lease of jobs a worker is still running.
 *
 * @param database - Database.
 * @param lease - `workerId` owning the jobs, the `jobIds` in progress and `now`, the current time.
 */
export function renewJobLeases(
  database: Database,
  {
    workerId,
    jobIds,
    now = new Date(),
  }: { readonly workerId: string; readonly jobIds: readonly string[]; readonly now?: Date },
): void {
  if (jobIds.length === 0) {
    return;
  }
  database
    .update(tables.jobs)
    .set({ leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_IN_MS).toISOString() })
    .where(
      and(
        inArray(tables.jobs.id, [...jobIds]),
        eq(tables.jobs.workerId, workerId),
        eq(tables.jobs.status, "running"),
      ),
    )
    .run();
}

/**
 * Marks a running job as succeeded.
 *
 * @param database - Database or open transaction.
 * @param jobId - Job to finish.
 * @param now - Current time.
 */
export function completeJob(
  database: Database | Transaction,
  jobId: string,
  now: Date = new Date(),
): void {
  database
    .update(tables.jobs)
    .set({ status: "succeeded", finishedAt: now.toISOString(), leaseExpiresAt: null })
    .where(and(eq(tables.jobs.id, jobId), eq(tables.jobs.status, "running")))
    .run();
}

/**
 * Marks a running job as failed, or puts it back in the queue when it may retry.
 *
 * @param database - Database or open transaction.
 * @param jobId - Job that failed.
 * @param failure - `errorMessage`, the reason without secrets; `retryable` allows another
 *   attempt while attempts remain; `now` is the current time.
 * @returns "requeued" or "failed".
 */
export function failJob(
  database: Database | Transaction,
  jobId: string,
  {
    errorMessage,
    retryable,
    now = new Date(),
  }: { readonly errorMessage: string; readonly retryable: boolean; readonly now?: Date },
): "requeued" | "failed" {
  const job = database
    .select({ attempts: tables.jobs.attempts, maxAttempts: tables.jobs.maxAttempts })
    .from(tables.jobs)
    .where(eq(tables.jobs.id, jobId))
    .get();
  if (job == null) {
    throw new Error(`Cannot fail unknown job ${jobId}`);
  }
  if (retryable && job.attempts < job.maxAttempts) {
    database
      .update(tables.jobs)
      .set({
        status: "queued",
        lastError: errorMessage,
        workerId: null,
        leaseExpiresAt: null,
        runAfter: new Date(now.getTime() + RETRY_DELAY_IN_MS).toISOString(),
      })
      .where(eq(tables.jobs.id, jobId))
      .run();
    return "requeued";
  }
  database
    .update(tables.jobs)
    .set({
      status: "failed",
      lastError: errorMessage,
      finishedAt: now.toISOString(),
      leaseExpiresAt: null,
    })
    .where(eq(tables.jobs.id, jobId))
    .run();
  return "failed";
}

/**
 * Cancels queued jobs that match a condition, such as a superseded deployment.
 *
 * @param database - Database or open transaction.
 * @param jobIds - Jobs to cancel; only those still queued change.
 * @param now - Current time.
 */
export function cancelQueuedJobs(
  database: Database | Transaction,
  jobIds: readonly string[],
  now: Date = new Date(),
): void {
  if (jobIds.length === 0) {
    return;
  }
  database
    .update(tables.jobs)
    .set({ status: "cancelled", finishedAt: now.toISOString() })
    .where(and(inArray(tables.jobs.id, [...jobIds]), eq(tables.jobs.status, "queued")))
    .run();
}

/** A job taken back from a worker that stopped renewing its lease. */
export type RecoveredJob = {
  readonly id: string;
  readonly kind: JobKind;
  readonly deploymentId: string | null;
  readonly taskExecutionId: string | null;
  readonly outcome: "requeued" | "failed";
};

/**
 * Recovers running jobs whose lease expired, which means their worker died.
 *
 * @param database - Database.
 * @param now - Current time.
 * @returns The recovered jobs, so callers can reset deployment or task state.
 */
export function recoverExpiredJobs(database: Database, now: Date = new Date()): RecoveredJob[] {
  return database.transaction((transaction) => {
    const expired = transaction
      .select({
        id: tables.jobs.id,
        kind: tables.jobs.kind,
        deploymentId: tables.jobs.deploymentId,
        taskExecutionId: tables.jobs.taskExecutionId,
      })
      .from(tables.jobs)
      .where(
        and(eq(tables.jobs.status, "running"), lt(tables.jobs.leaseExpiresAt, now.toISOString())),
      )
      .all();
    return expired.map((job) =>
      Object.assign(job, {
        outcome: failJob(transaction, job.id, {
          errorMessage: "Worker stopped while the job was running",
          retryable: true,
          now,
        }),
      }),
    );
  });
}

/**
 * Releases every running job of a worker, used at startup when the previous process of the
 * same worker id died without finishing them.
 *
 * @param database - Database.
 * @param workerId - Worker whose jobs are released.
 * @param now - Current time.
 * @returns The recovered jobs.
 */
export function releaseWorkerJobs(
  database: Database,
  workerId: string,
  now: Date = new Date(),
): RecoveredJob[] {
  database
    .update(tables.jobs)
    .set({ leaseExpiresAt: new Date(0).toISOString() })
    .where(and(eq(tables.jobs.workerId, workerId), eq(tables.jobs.status, "running")))
    .run();
  return recoverExpiredJobs(database, now);
}
