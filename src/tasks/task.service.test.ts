import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import {
  failTaskExecutions,
  listTaskExecutions,
  scheduleDueTasks,
  updateTaskExecution,
} from "./task-execution.service";
import { InvalidScheduleError, TaskRunningError } from "./task.errors";
import { createTask, deleteTask, listTasks, runTask } from "./task.service";

const TIME_ZONE = "UTC";
const T0 = new Date("2026-10-28T10:00:30.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return taskInputSchema.parse({
    name: "Limpar cache",
    commandLine: "bun run cache:clear",
    schedule: "*/5 * * * *",
    enabled: true,
    timeoutInSeconds: 60,
    ...overrides,
  });
}

describe("tasks", () => {
  test("crash recovery preserves a task's recorded failure instead of replacing its reason", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const taskId = createTask(database, {
      projectId: project.id,
      input: input(),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
    });
    const executionId = runTask(database, {
      projectId: project.id,
      taskId,
      trigger: "manual",
      actor: TEST_ACTOR,
      userId: null,
    });
    updateTaskExecution(database, executionId, {
      status: "failed",
      errorMessage: "Task exceeded its timeout",
    });
    failTaskExecutions(database, [executionId], "Generic job failure");
    expect(
      listTaskExecutions(database, { projectId: project.id, taskId, limit: 10 }).at(0)
        ?.errorMessage,
    ).toBe("Task exceeded its timeout");
  });
  test("refuses deletion while a worker owns a task execution", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const taskId = createTask(database, {
      projectId: project.id,
      input: input(),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });
    runTask(database, {
      projectId: project.id,
      taskId,
      trigger: "manual",
      actor: TEST_ACTOR,
      userId: null,
    });
    const claimed = claimNextJob(database, "worker");

    expect(() =>
      deleteTask(database, { projectId: project.id, taskId, actor: TEST_ACTOR }),
    ).toThrow(TaskRunningError);

    expect(claimed?.kind).toBe("task_run");
    expect(listTasks(database, project.id)).toHaveLength(1);
    expect(database.select({ id: tables.jobs.id }).from(tables.jobs).all()).toHaveLength(1);
    database.$client.close();
  });
  test("computes the next run when a scheduled task is created", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    createTask(database, {
      projectId: project.id,
      input: input(),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });

    expect(listTasks(database, project.id)[0]?.nextRunAt).toBe("2026-10-28T10:05:00.000Z");
  });

  test("throws InvalidScheduleError for a malformed cron expression", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const create = () =>
      createTask(database, {
        projectId: project.id,
        input: input({ schedule: "every minute" }),
        actor: TEST_ACTOR,
        userId: null,
        timeZone: TIME_ZONE,
        now: T0,
      });

    expect(create).toThrow(InvalidScheduleError);
  });
});

describe("task scheduling", () => {
  test("queues a due task once and advances its schedule", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    createTask(database, {
      projectId: project.id,
      input: input(),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });
    const due = new Date("2026-10-28T10:05:01.000Z");

    const queued = scheduleDueTasks(database, due, TIME_ZONE);
    const again = scheduleDueTasks(database, due, TIME_ZONE);

    expect(queued).toHaveLength(1);
    expect(again).toHaveLength(0);
    expect(listTasks(database, project.id)[0]?.nextRunAt).toBe("2026-10-28T10:10:00.000Z");
  });

  test("never runs the same scheduled slot twice even if the schedule is reset", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    createTask(database, {
      projectId: project.id,
      input: input(),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });
    const due = new Date("2026-10-28T10:05:01.000Z");
    scheduleDueTasks(database, due, TIME_ZONE);
    // Simulates a crash after queuing but before the schedule advanced.
    database.update(tables.tasks).set({ nextRunAt: "2026-10-28T10:05:00.000Z" }).run();

    const queued = scheduleDueTasks(database, due, TIME_ZONE);

    expect(queued).toHaveLength(0);
  });
});

describe("task scheduling of disabled tasks", () => {
  test("does not schedule disabled tasks", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    createTask(database, {
      projectId: project.id,
      input: input({ enabled: false }),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });

    expect(scheduleDueTasks(database, new Date("2026-10-29T00:00:00Z"), TIME_ZONE)).toEqual([]);
  });
});

describe("manual task runs", () => {
  test("a manual run creates an execution and a task job", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const taskId = createTask(database, {
      projectId: project.id,
      input: input({ schedule: "" }),
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });

    const executionId = runTask(database, {
      projectId: project.id,
      taskId,
      trigger: "manual",
      actor: TEST_ACTOR,
      userId: null,
    });

    const job = claimNextJob(database, "worker");
    expect(job?.kind).toBe("task_run");
    expect(job?.taskExecutionId).toBe(executionId);
  });
});
