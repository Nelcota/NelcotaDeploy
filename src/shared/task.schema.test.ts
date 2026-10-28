import { describe, expect, test } from "bun:test";

import { taskInputSchema } from "./task.schema";

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

  test("rejects an unterminated quote", () => {
    expect(taskInputSchema.safeParse({ ...validTask, commandLine: "echo 'x" }).success).toBe(false);
  });

  test.each([0, -5, 3601])("rejects timeout %p", (timeoutInSeconds) => {
    expect(taskInputSchema.safeParse({ ...validTask, timeoutInSeconds }).success).toBe(false);
  });
});
