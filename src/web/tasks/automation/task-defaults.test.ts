import { expect, test } from "bun:test";

import type { Task } from "@/tasks";

import { taskDefaults, requiresScheduleReview } from "./task-defaults";

const script = { name: "db:migrate", commandLine: "bun run db:migrate" };
const values = { name: "", commandLine: "" };
const scheduled = {
  name: "cleanup",
  commandLine: "bun run cleanup",
  schedule: "0 3 * * *",
  enabled: true,
  timeoutInSeconds: 300,
};
const previous: Task = {
  id: "task",
  projectId: "project",
  name: "cleanup",
  command: ["bun", "run", "cleanup"],
  schedule: "0 3 * * *",
  enabled: true,
  timeoutInSeconds: 300,
  nextRunAt: null,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
};

test("fills a detected task and finds an available name", () => {
  expect(
    taskDefaults({
      script,
      values,
      manual: new Set(),
      existingNames: ["db:migrate", "db:migrate-2"],
    }),
  ).toEqual({ name: "db:migrate-3", commandLine: script.commandLine });
});

test("preserves custom names and commands independently", () => {
  expect(
    taskDefaults({
      script,
      values: { name: "My task", commandLine: "bun run backup --safe" },
      manual: new Set(["name", "commandLine"]),
      existingNames: [],
    }),
  ).toEqual({});
  expect(
    taskDefaults({
      script,
      values: { name: "", commandLine: "bun run backup --safe" },
      manual: new Set(["commandLine"]),
      existingNames: [],
    }),
  ).toEqual({ name: "backup" });
  expect(
    taskDefaults({
      script,
      values: { name: "My task", commandLine: "" },
      manual: new Set(["name"]),
      existingNames: [],
    }),
  ).toEqual({ commandLine: script.commandLine });
});

test("clears stale automatic fields when a package no longer has an unambiguous script", () => {
  expect(
    taskDefaults({
      script: null,
      values: { name: "old", commandLine: "bun run old" },
      manual: new Set(),
      existingNames: [],
    }),
  ).toEqual({ name: "", commandLine: "" });
});

test.each(["", "bun run", "bun run --unsafe", "bun run 'unterminated", "echo anything"])(
  "does not invent a task name for %s",
  (commandLine) => {
    expect(
      taskDefaults({
        script: null,
        values: { name: "", commandLine },
        manual: new Set(["commandLine"]),
        existingNames: [],
      }),
    ).toEqual({ name: "" });
  },
);

test("keeps generated names within the shared limit", () => {
  const name = "a".repeat(64);
  expect(
    taskDefaults({
      script: { name, commandLine: `bun run ${name}` },
      values,
      manual: new Set(),
      existingNames: [name],
    }).name,
  ).toHaveLength(64);
});

test("requires confirmation for new schedules, reactivation and material schedule changes", () => {
  expect(requiresScheduleReview(null, scheduled)).toBe(true);
  expect(requiresScheduleReview({ ...previous, enabled: false }, scheduled)).toBe(true);
  expect(requiresScheduleReview(previous, { ...scheduled, commandLine: "bun run migrate" })).toBe(
    true,
  );
  expect(requiresScheduleReview(previous, { ...scheduled, schedule: "0 * * * *" })).toBe(true);
  expect(requiresScheduleReview(previous, { ...scheduled, timeoutInSeconds: 600 })).toBe(true);
});

test("does not add confirmations to manual tasks, pauses or name-only edits", () => {
  expect(requiresScheduleReview(null, { ...scheduled, schedule: "" })).toBe(false);
  expect(requiresScheduleReview(previous, { ...scheduled, enabled: false })).toBe(false);
  expect(requiresScheduleReview(previous, { ...scheduled, name: "New display name" })).toBe(false);
});
