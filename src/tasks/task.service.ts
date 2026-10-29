import { and, asc, eq, ne, sql } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { getProject } from "@/projects";
import type { TaskInput } from "@/shared/schemas/task.schema";

import { nextScheduledRun } from "./schedule";
import { enqueueExecution } from "./task-execution.service";
import { TaskNameTakenError, TaskNotFoundError } from "./task.errors";

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
