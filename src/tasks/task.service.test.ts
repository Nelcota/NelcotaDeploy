import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { taskInputSchema } from "@/shared/task.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { InvalidScheduleError } from "./task.errors";
import { createTask, listTasks, runTask, scheduleDueTasks } from "./task.service";

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
  test("computes the next run when a scheduled task is created", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    createTask(database, project.id, input(), {
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
      createTask(database, project.id, input({ schedule: "every minute" }), {
        actor: TEST_ACTOR,
        userId: null,
        timeZone: TIME_ZONE,
        now: T0,
      });

    expect(create).toThrow(InvalidScheduleError);
  });

  test("queues a due task once and advances its schedule", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    createTask(database, project.id, input(), {
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
    createTask(database, project.id, input(), {
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

  test("does not schedule disabled tasks", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    createTask(database, project.id, input({ enabled: false }), {
      actor: TEST_ACTOR,
      userId: null,
      timeZone: TIME_ZONE,
      now: T0,
    });

    expect(scheduleDueTasks(database, new Date("2026-10-29T00:00:00Z"), TIME_ZONE)).toEqual([]);
  });

  test("a manual run creates an execution and a task job", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const taskId = createTask(database, project.id, input({ schedule: "" }), {
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
