import { z } from "zod";

import { formatCommandLine } from "@/shared/command-line";
import { DEFAULT_TASK_TIMEOUT_IN_SECONDS, taskInputSchema } from "@/shared/schemas/task.schema";
import type { Task } from "@/tasks";

/** Raw form values, as the server function validates them. */
export type TaskFormValues = {
  name: string;
  commandLine: string;
  schedule: string;
  enabled: boolean;
  timeoutInSeconds: number;
};

/**
 * Fills the task form from a saved task, or with defaults for a new one.
 *
 * @param task - Saved task, or null for a new one.
 * @param enabled - Overrides the enabled flag, as the row switch does.
 * @returns Values for the form and the update server function.
 */
export function toTaskFormValues(task: Task | null, enabled?: boolean): TaskFormValues {
  if (task == null) {
    return {
      name: "",
      commandLine: "",
      schedule: "",
      enabled: enabled ?? true,
      timeoutInSeconds: DEFAULT_TASK_TIMEOUT_IN_SECONDS,
    };
  }
  return {
    name: task.name,
    commandLine: formatCommandLine(task.command),
    schedule: task.schedule ?? "",
    enabled: enabled ?? task.enabled,
    timeoutInSeconds: task.timeoutInSeconds,
  };
}

/**
 * Validates the whole form with the shared schema and maps issues to fields.
 *
 * @returns The first message of each invalid field, or undefined when the form is valid.
 */
export function validateTaskForm(value: TaskFormValues) {
  const result = taskInputSchema.safeParse(value);
  if (result.success) {
    return undefined;
  }
  const fields: Partial<Record<keyof TaskFormValues, string>> = {};
  const fieldErrors = z.flattenError(result.error).fieldErrors;
  for (const name of Object.keys(value) as (keyof TaskFormValues)[]) {
    const message = (fieldErrors as Partial<Record<string, string[]>>)[name]?.[0];
    if (message != null) {
      fields[name] = message;
    }
  }
  return { fields };
}
