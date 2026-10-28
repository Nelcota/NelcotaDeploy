import { describe, expect, test } from "bun:test";

import { DEFAULT_TASK_TIMEOUT_IN_SECONDS } from "@/shared/task.schema";

import { toTaskFormValues, validateTaskForm } from "./task-form-values";

const VALID = {
  name: "Limpar cache",
  commandLine: "bun run cache:clear",
  schedule: "0 3 * * *",
  enabled: true,
  timeoutInSeconds: 60,
};

describe("toTaskFormValues", () => {
  test("starts a new task enabled, without schedule and with the default timeout", () => {
    const values = toTaskFormValues(null);

    expect(values).toEqual({
      name: "",
      commandLine: "",
      schedule: "",
      enabled: true,
      timeoutInSeconds: DEFAULT_TASK_TIMEOUT_IN_SECONDS,
    });
  });
});

describe("validateTaskForm", () => {
  test("accepts a valid form", () => {
    const result = validateTaskForm(VALID);

    expect(result).toBeUndefined();
  });

  test("reports a blank name on the name field", () => {
    const result = validateTaskForm({ ...VALID, name: "   " });

    expect(result?.fields.name).toBe("Campo obrigatório");
  });

  test("reports a zero timeout on the timeout field", () => {
    const result = validateTaskForm({ ...VALID, timeoutInSeconds: 0 });

    expect(result?.fields.timeoutInSeconds).toBe("Mínimo de 1 segundo");
  });
});
