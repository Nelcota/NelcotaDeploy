import { describe, expect, test } from "bun:test";

import { taskInputSchema, taskRunReviewSchema } from "./task.schema";

const validTask = {
  name: "Migrar banco",
  commandLine: "bun run db:migrate",
  schedule: "",
  enabled: true,
  timeoutInSeconds: 300,
};

describe("taskInputSchema", () => {
  test("parses the command line into an argument vector", () => {
    const task = taskInputSchema.parse(validTask);

    expect(task.command).toEqual(["bun", "run", "db:migrate"]);
    expect(task.schedule).toBeNull();
  });

  test("rejects an empty command", () => {
    expect(taskInputSchema.safeParse({ ...validTask, commandLine: "  " }).success).toBe(false);
  });

  test.each(['""', '"   "'])("rejects an empty executable %s", (commandLine) => {
    expect(taskInputSchema.safeParse({ ...validTask, commandLine }).success).toBe(false);
  });

  test("rejects an unterminated quote", () => {
    expect(taskInputSchema.safeParse({ ...validTask, commandLine: "echo 'x" }).success).toBe(false);
  });

  test.each([0, -5, 3601])("rejects timeout %p", (timeoutInSeconds) => {
    expect(taskInputSchema.safeParse({ ...validTask, timeoutInSeconds }).success).toBe(false);
  });
});

describe("taskRunReviewSchema", () => {
  test("preserves an empty argument after a valid executable", () => {
    expect(
      taskRunReviewSchema.safeParse({ command: ["echo", ""], timeoutInSeconds: 1 }).success,
    ).toBe(true);
  });

  test.each([
    { command: [] },
    { command: [""] },
    { command: [" "] },
    { command: ["echo", "bad\0value"] },
    { command: Array.from({ length: 65 }, () => "argument") },
  ])("rejects an invalid reviewed command", ({ command }) => {
    expect(taskRunReviewSchema.safeParse({ command, timeoutInSeconds: 60 }).success).toBe(false);
  });

  test.each([0, -1, 3601, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid reviewed timeout %s",
    (timeoutInSeconds) => {
      expect(taskRunReviewSchema.safeParse({ command: ["echo"], timeoutInSeconds }).success).toBe(
        false,
      );
    },
  );
});
