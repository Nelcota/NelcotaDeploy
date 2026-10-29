import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";

import { nextScheduledRun } from "./schedule";

const MAX_EXECUTIONS_PAGE = 100;
const MAX_OUTPUT_LENGTH = 65_536;

type TaskExecutionTrigger = (typeof tables.taskExecutions.$inferSelect)["trigger"];
export type TaskExecutionStatus = (typeof tables.taskExecutions.$inferSelect)["status"];

const executionColumns = {
  id: tables.taskExecutions.id,
  taskId: tables.taskExecutions.taskId,
  projectId: tables.taskExecutions.projectId,
  trigger: tables.taskExecutions.trigger,
  scheduledFor: tables.taskExecutions.scheduledFor,
  status: tables.taskExecutions.status,
  exitCode: tables.taskExecutions.exitCode,
  output: tables.taskExecutions.output,
  errorMessage: tables.taskExecutions.errorMessage,
  createdAt: tables.taskExecutions.createdAt,
  startedAt: tables.taskExecutions.startedAt,
  finishedAt: tables.taskExecutions.finishedAt,
};

export type TaskExecution = {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly trigger: TaskExecutionTrigger;
  readonly scheduledFor: string | null;
  readonly status: TaskExecutionStatus;
  readonly exitCode: number | null;
  readonly output: string;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

/**
 * Records a queued execution of a task and its worker job.
 *
 * @param transaction - Open transaction.
 * @param input - Task, trigger, scheduled slot, requesting user and current time.
 * @returns The execution id, or null when this scheduled slot already has an execution.
 */
export function enqueueExecution(
  transaction: Transaction,
  input: {
    readonly task: { readonly id: string; readonly projectId: string };
    readonly trigger: TaskExecutionTrigger;
    readonly scheduledFor: string | null;
    readonly userId: string | null;
    readonly now: Date;
  },
): string | null {
  const executionId = Bun.randomUUIDv7();
  // A skipped or unmatched write returns no row, which `.get()` does not admit in its type.
  const inserted = transaction
    .insert(tables.taskExecutions)
    .values({
      id: executionId,
      taskId: input.task.id,
      projectId: input.task.projectId,
      trigger: input.trigger,
      scheduledFor: input.scheduledFor,
      status: "queued",
      triggeredByUserId: input.userId,
      createdAt: input.now.toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: tables.taskExecutions.id })
    .all()
    .at(0);
  if (inserted == null) {
    return null;
  }
  enqueueJob(
    transaction,
    { kind: "task_run", projectId: input.task.projectId, taskExecutionId: executionId },
    input.now,
  );
  return executionId;
}

/**
 * Queues every scheduled task whose next run is due, then advances its schedule.
 *
 * @remarks
 * Each due slot is recorded with a unique (task, scheduledFor) pair, so a restart or a
 * second scheduler cannot run the same slot twice. Slots missed while the worker was down
 * run once, not once per missed slot.
 *
 * @param database - Database.
 * @param now - Current time.
 * @param timeZone - Time zone of the cron expressions.
 * @returns Ids of the executions queued.
 */
export function scheduleDueTasks(database: Database, now: Date, timeZone: string): string[] {
  return database.transaction((transaction) => {
    const due = transaction
      .select({
        id: tables.tasks.id,
        projectId: tables.tasks.projectId,
        schedule: tables.tasks.schedule,
        nextRunAt: tables.tasks.nextRunAt,
      })
      .from(tables.tasks)
      .innerJoin(tables.projects, eq(tables.projects.id, tables.tasks.projectId))
      .where(
        and(
          eq(tables.tasks.enabled, true),
          isNotNull(tables.tasks.schedule),
          lte(tables.tasks.nextRunAt, now.toISOString()),
          sql`${tables.projects.deletionRequestedAt} IS NULL`,
        ),
      )
      .all();
    const queued: string[] = [];
    for (const task of due) {
      const executionId = enqueueExecution(transaction, {
        task,
        trigger: "schedule",
        scheduledFor: task.nextRunAt,
        userId: null,
        now,
      });
      if (executionId != null) {
        queued.push(executionId);
      }
      transaction
        .update(tables.tasks)
        .set({ nextRunAt: nextScheduledRun(task.schedule ?? "", now, timeZone).toISOString() })
        .where(eq(tables.tasks.id, task.id))
        .run();
    }
    return queued;
  });
}

/**
 * Lists a task's executions, newest first.
 *
 * @param database - Database.
 * @param page - Owning project, task id and `limit`, the page size between 1 and 100.
 * @returns Executions with their output.
 */
export function listTaskExecutions(
  database: Database,
  {
    projectId,
    taskId,
    limit,
  }: { readonly projectId: string; readonly taskId: string; readonly limit: number },
): TaskExecution[] {
  return database
    .select(executionColumns)
    .from(tables.taskExecutions)
    .where(
      and(eq(tables.taskExecutions.taskId, taskId), eq(tables.taskExecutions.projectId, projectId)),
    )
    .orderBy(desc(tables.taskExecutions.createdAt))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_EXECUTIONS_PAGE))
    .all();
}

/**
 * Reads the execution context the worker needs.
 *
 * @param database - Database.
 * @param executionId - Execution id.
 * @returns Execution, task command and timeout, or null when it no longer exists.
 */
export function getExecutionForRun(database: Database, executionId: string) {
  return (
    database
      .select({
        id: tables.taskExecutions.id,
        status: tables.taskExecutions.status,
        projectId: tables.taskExecutions.projectId,
        command: tables.tasks.command,
        timeoutInSeconds: tables.tasks.timeoutInSeconds,
        taskName: tables.tasks.name,
      })
      .from(tables.taskExecutions)
      .innerJoin(tables.tasks, eq(tables.tasks.id, tables.taskExecutions.taskId))
      .where(eq(tables.taskExecutions.id, executionId))
      .get() ?? null
  );
}

/**
 * Records the progress or result of an execution.
 *
 * @param database - Database.
 * @param executionId - Execution id.
 * @param update - New status and, when finished, exit code and output (truncated to 64 KB).
 */
export function updateTaskExecution(
  database: Database,
  executionId: string,
  update: {
    readonly status: TaskExecutionStatus;
    readonly exitCode?: number | null;
    readonly output?: string;
    readonly errorMessage?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const finished = update.status === "succeeded" || update.status === "failed";
  database
    .update(tables.taskExecutions)
    .set({
      status: update.status,
      ...(update.exitCode === undefined ? {} : { exitCode: update.exitCode }),
      ...(update.output === undefined ? {} : { output: update.output.slice(-MAX_OUTPUT_LENGTH) }),
      ...(update.errorMessage === undefined ? {} : { errorMessage: update.errorMessage }),
      ...(update.status === "running" ? { startedAt: now } : {}),
      ...(finished ? { finishedAt: now } : {}),
    })
    .where(eq(tables.taskExecutions.id, executionId))
    .run();
}

/**
 * Marks executions as failed when their job was abandoned, for example after a crash.
 *
 * @param database - Database.
 * @param executionIds - Executions to fail.
 * @param reason - Error message.
 */
export function failTaskExecutions(
  database: Database,
  executionIds: readonly string[],
  reason: string,
): void {
  if (executionIds.length === 0) {
    return;
  }
  database
    .update(tables.taskExecutions)
    .set({ status: "failed", errorMessage: reason, finishedAt: new Date().toISOString() })
    .where(inArray(tables.taskExecutions.id, [...executionIds]))
    .run();
}
