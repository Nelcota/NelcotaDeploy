import { and, asc, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";
import { getProject } from "@/projects";
import type { TaskInput } from "@/shared/schemas/task.schema";

import { nextScheduledRun } from "./schedule";
import { TaskNameTakenError, TaskNotFoundError } from "./task.errors";

const MAX_EXECUTIONS_PAGE = 100;
const MAX_OUTPUT_LENGTH = 65_536;

type TaskExecutionTrigger = (typeof tables.taskExecutions.$inferSelect)["trigger"];
export type TaskExecutionStatus = (typeof tables.taskExecutions.$inferSelect)["status"];

const taskColumns = {
  id: tables.tasks.id,
  projectId: tables.tasks.projectId,
  name: tables.tasks.name,
  command: tables.tasks.command,
  schedule: tables.tasks.schedule,
  enabled: tables.tasks.enabled,
  timeoutInSeconds: tables.tasks.timeoutInSeconds,
  nextRunAt: tables.tasks.nextRunAt,
  createdAt: tables.tasks.createdAt,
  updatedAt: tables.tasks.updatedAt,
};

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

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly command: string[];
  readonly schedule: string | null;
  readonly enabled: boolean;
  readonly timeoutInSeconds: number;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
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

function computeNextRunAt(input: TaskInput, now: Date, timeZone: string): string | null {
  if (input.schedule == null || input.enabled === false) {
    return null;
  }
  return nextScheduledRun(input.schedule, now, timeZone).toISOString();
}

function assertNameAvailable(
  transaction: Transaction,
  projectId: string,
  { name, exceptTaskId }: { readonly name: string; readonly exceptTaskId?: string },
): void {
  const existing = transaction
    .select({ id: tables.tasks.id })
    .from(tables.tasks)
    .where(
      and(
        eq(tables.tasks.projectId, projectId),
        eq(tables.tasks.name, name),
        exceptTaskId == null ? undefined : ne(tables.tasks.id, exceptTaskId),
      ),
    )
    .get();
  if (existing != null) {
    throw new TaskNameTakenError(name);
  }
}

/**
 * Creates a task for a project.
 *
 * @param database - Database.
 * @param request - Owning `projectId`, the validated task `input` with its argument vector,
 *   the actor, the creating user and the time zone schedules are written in.
 * @returns The task id.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {InvalidScheduleError} When the cron expression is invalid.
 * @throws {TaskNameTakenError} When the name is already used in the project.
 */
export function createTask(
  database: Database,
  {
    projectId,
    input,
    ...context
  }: {
    readonly projectId: string;
    readonly input: TaskInput;
    readonly actor: Actor;
    readonly userId: string | null;
    readonly timeZone: string;
    readonly now?: Date;
  },
): string {
  const now = context.now ?? new Date();
  const nextRunAt = computeNextRunAt(input, now, context.timeZone);
  const taskId = Bun.randomUUIDv7();
  database.transaction((transaction) => {
    getProject(transaction, projectId);
    assertNameAvailable(transaction, projectId, { name: input.name });
    transaction
      .insert(tables.tasks)
      .values({
        id: taskId,
        projectId,
        ...input,
        nextRunAt,
        createdByUserId: context.userId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .run();
    recordAuditEvent(transaction, {
      actor: context.actor,
      action: "task.create",
      targetType: "task",
      targetId: taskId,
      metadata: { projectId, name: input.name, command: input.command, schedule: input.schedule },
    });
  });
  return taskId;
}

/**
 * Updates a task and recomputes its next scheduled run.
 *
 * @param database - Database.
 * @param request - Owning `projectId`, the `taskId`, the validated task `input`, the actor and
 *   the schedule time zone.
 * @throws {TaskNotFoundError} When the task is not in this project.
 * @throws {InvalidScheduleError} When the cron expression is invalid.
 * @throws {TaskNameTakenError} When the name is already used in the project.
 */
export function updateTask(
  database: Database,
  {
    projectId,
    taskId,
    input,
    ...context
  }: {
    readonly projectId: string;
    readonly taskId: string;
    readonly input: TaskInput;
    readonly actor: Actor;
    readonly timeZone: string;
    readonly now?: Date;
  },
): void {
  const now = context.now ?? new Date();
  const nextRunAt = computeNextRunAt(input, now, context.timeZone);
  database.transaction((transaction) => {
    findTaskRow(transaction, projectId, taskId);
    assertNameAvailable(transaction, projectId, { name: input.name, exceptTaskId: taskId });
    transaction
      .update(tables.tasks)
      .set({ ...input, nextRunAt, updatedAt: now.toISOString() })
      .where(eq(tables.tasks.id, taskId))
      .run();
    recordAuditEvent(transaction, {
      actor: context.actor,
      action: "task.update",
      targetType: "task",
      targetId: taskId,
      metadata: {
        projectId,
        name: input.name,
        command: input.command,
        schedule: input.schedule,
        enabled: input.enabled,
      },
    });
  });
}

/**
 * Deletes a task and its history.
 *
 * @param database - Database.
 * @param removal - Owning project, task id and who deletes it.
 * @throws {TaskNotFoundError} When the task is not in this project.
 */
export function deleteTask(
  database: Database,
  {
    projectId,
    taskId,
    actor,
  }: { readonly projectId: string; readonly taskId: string; readonly actor: Actor },
): void {
  database.transaction((transaction) => {
    const task = findTaskRow(transaction, projectId, taskId);
    transaction.delete(tables.tasks).where(eq(tables.tasks.id, taskId)).run();
    recordAuditEvent(transaction, {
      actor,
      action: "task.delete",
      targetType: "task",
      targetId: taskId,
      metadata: { projectId, name: task.name },
    });
  });
}

function findTaskRow(database: Database | Transaction, projectId: string, taskId: string): Task {
  const task = database
    .select(taskColumns)
    .from(tables.tasks)
    .where(and(eq(tables.tasks.id, taskId), eq(tables.tasks.projectId, projectId)))
    .get();
  if (task == null) {
    throw new TaskNotFoundError(taskId);
  }
  return task;
}

/**
 * Lists a project's tasks with their latest execution.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns Tasks sorted by name.
 */
export function listTasks(database: Database, projectId: string) {
  const projectTasks = database
    .select(taskColumns)
    .from(tables.tasks)
    .where(eq(tables.tasks.projectId, projectId))
    .orderBy(asc(tables.tasks.name))
    .all();
  if (projectTasks.length === 0) {
    return [];
  }
  const latestExecutions = database
    .select({
      taskId: tables.taskExecutions.taskId,
      status: tables.taskExecutions.status,
      createdAt: tables.taskExecutions.createdAt,
      startedAt: tables.taskExecutions.startedAt,
      finishedAt: tables.taskExecutions.finishedAt,
    })
    .from(tables.taskExecutions)
    .where(
      and(
        eq(tables.taskExecutions.projectId, projectId),
        eq(
          tables.taskExecutions.id,
          sql`(
            SELECT latest.id FROM task_executions AS latest
            WHERE latest.task_id = ${tables.taskExecutions.taskId}
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
          )`,
        ),
      ),
    )
    .all();
  const latestByTask = new Map(latestExecutions.map((execution) => [execution.taskId, execution]));
  return projectTasks.map((task) =>
    Object.assign(task, { latestExecution: latestByTask.get(task.id) ?? null }),
  );
}

function enqueueExecution(
  transaction: Transaction,
  input: {
    readonly task: Pick<Task, "id" | "projectId">;
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
 * Queues a manual run of a task.
 *
 * @param database - Database.
 * @param request - Task, trigger and actor.
 * @returns The execution id.
 * @throws {TaskNotFoundError} When the task is not in this project.
 */
export function runTask(
  database: Database,
  request: {
    readonly projectId: string;
    readonly taskId: string;
    readonly trigger: "manual" | "mcp";
    readonly actor: Actor;
    readonly userId: string | null;
  },
): string {
  return database.transaction((transaction) => {
    const task = findTaskRow(transaction, request.projectId, request.taskId);
    getProject(transaction, request.projectId);
    const executionId = enqueueExecution(transaction, {
      task,
      trigger: request.trigger,
      scheduledFor: null,
      userId: request.userId,
      now: new Date(),
    });
    if (executionId == null) {
      throw new Error(`Manual execution of task ${task.id} was ignored`);
    }
    recordAuditEvent(transaction, {
      actor: request.actor,
      action: "task.run",
      targetType: "task",
      targetId: task.id,
      metadata: { projectId: task.projectId, executionId },
    });
    return executionId;
  });
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
