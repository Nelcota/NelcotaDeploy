import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { getExecutionForRun, listTaskExecutions, scheduleDueTasks } from "./task-execution.service";
import { TaskReviewChangedError } from "./task.errors";
import { createTask, listTasks, runTask, updateTask } from "./task.service";

const T0 = new Date("2026-11-06T12:00:00Z");
const T1 = new Date("2026-11-06T12:00:01Z");
const taskInput = taskInputSchema.parse({
  name: "cleanup",
  commandLine: "bun run cleanup",
  schedule: "* * * * *",
  enabled: true,
  timeoutInSeconds: 60,
});

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const context = { projectId: project.id, actor: TEST_ACTOR, timeZone: "UTC", userId: null };
  const taskId = createTask(database, { ...context, input: taskInput, now: T0 });
  return { database, context, taskId, target: { ...context, taskId, trigger: "manual" as const } };
}

test("refuses changed reviewed commands without enqueuing a run", () => {
  const { database, target } = setup();
  using _connection = database.$client;
  expect(() =>
    runTask(database, {
      ...target,
      expected: { command: ["bun", "run", "other"], timeoutInSeconds: 60 },
    }),
  ).toThrow(TaskReviewChangedError);
  expect(listTaskExecutions(database, { ...target, limit: 10 })).toEqual([]);
  expect(claimNextJob(database, "worker")).toBeNull();
});

test("refuses changed reviewed timeouts", () => {
  const { database, target } = setup();
  using _connection = database.$client;
  expect(() =>
    runTask(database, {
      ...target,
      expected: { command: taskInput.command, timeoutInSeconds: 600 },
    }),
  ).toThrow(TaskReviewChangedError);
});

test("keeps the confirmed command and timeout after the saved task is edited", () => {
  const { database, target, context, taskId } = setup();
  using _connection = database.$client;
  const executionId = runTask(database, {
    ...target,
    expected: { command: taskInput.command, timeoutInSeconds: 60 },
  });
  updateTask(database, {
    ...context,
    taskId,
    input: { ...taskInput, command: ["bun", "run", "different"], timeoutInSeconds: 600 },
    now: T1,
  });
  expect(getExecutionForRun(database, executionId)).toMatchObject({
    command: ["bun", "run", "cleanup"],
    timeoutInSeconds: 60,
  });
  expect(listTasks(database, context.projectId).at(0)?.command).toEqual([
    "bun",
    "run",
    "different",
  ]);
});

test("also captures commands for scheduled executions", () => {
  const { database, context, taskId } = setup();
  using _connection = database.$client;
  const executions = scheduleDueTasks(database, new Date("2026-11-06T12:01:00Z"), "UTC");
  const executionId = executions.at(0);
  if (executionId == null) {
    throw new Error("Expected a scheduled execution");
  }
  updateTask(database, {
    ...context,
    taskId,
    input: { ...taskInput, command: ["other"] },
    now: T1,
  });
  expect(getExecutionForRun(database, executionId)?.command).toEqual(taskInput.command);
});

test("refuses to replace a schedule edited after its review", () => {
  const { database, context, taskId } = setup();
  using _connection = database.$client;
  updateTask(database, {
    ...context,
    taskId,
    input: { ...taskInput, command: ["other"] },
    now: T1,
  });
  expect(() =>
    updateTask(database, {
      ...context,
      taskId,
      input: taskInput,
      expectedUpdatedAt: T0.toISOString(),
    }),
  ).toThrow(TaskReviewChangedError);
  expect(listTasks(database, context.projectId).at(0)?.command).toEqual(["other"]);
});

test("rejects malformed snapshots instead of falling back to a different command", () => {
  const { database, target } = setup();
  using _connection = database.$client;
  const executionId = runTask(database, target);
  database
    .update(tables.jobs)
    .set({ payload: { task: { command: "invalid" } } })
    .where(eq(tables.jobs.taskExecutionId, executionId))
    .run();
  expect(() => getExecutionForRun(database, executionId)).toThrow("Invalid queued task snapshot");
});

test("still reads legacy executions whose jobs predate command snapshots", () => {
  const { database, target } = setup();
  using _connection = database.$client;
  const executionId = runTask(database, target);
  database
    .update(tables.jobs)
    .set({ payload: {} })
    .where(eq(tables.jobs.taskExecutionId, executionId))
    .run();
  expect(getExecutionForRun(database, executionId)?.command).toEqual(taskInput.command);
});
