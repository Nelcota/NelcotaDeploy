import { formatCommandLine, parseCommandLine } from "@/shared/command-line";
import { CommandLineParseError } from "@/shared/command-line.errors";
import type { Task } from "@/tasks";

import type { TaskFormValues } from "../task-form-values";

const MAX_NAME_LENGTH = 64;
type AutomaticField = "name" | "commandLine";

function scriptFromCommand(value: string): string | null {
  if (value.length > 8192 || value.trim() === "") {
    return null;
  }
  try {
    const args = parseCommandLine(value);
    const script = args.at(2);
    return args.at(0) === "bun" &&
      args.at(1) === "run" &&
      script != null &&
      /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(script)
      ? script
      : null;
  } catch (error) {
    if (error instanceof CommandLineParseError) {
      return null;
    }
    throw error;
  }
}

function availableTaskName(base: string, existingNames: readonly string[]): string {
  const used = new Set(existingNames);
  if (used.has(base) === false) {
    return base;
  }
  for (let suffix = 2; suffix <= used.size + 2; suffix += 1) {
    const ending = `-${suffix}`;
    const name = `${base.slice(0, MAX_NAME_LENGTH - ending.length)}${ending}`;
    if (used.has(name) === false) {
      return name;
    }
  }
  throw new Error("Unable to suggest an available task name");
}

/** Fills untouched fields only, using the actual custom command as the name's source when present. */
export function taskDefaults(input: {
  readonly script: { readonly name: string; readonly commandLine: string } | null;
  readonly values: Pick<TaskFormValues, "name" | "commandLine">;
  readonly manual: ReadonlySet<AutomaticField>;
  readonly existingNames: readonly string[];
}): Partial<Pick<TaskFormValues, AutomaticField>> {
  const commandLine = input.manual.has("commandLine")
    ? input.values.commandLine
    : (input.script?.commandLine ?? "");
  const name = scriptFromCommand(commandLine);
  return {
    ...(input.manual.has("commandLine") ? {} : { commandLine }),
    ...(input.manual.has("name")
      ? {}
      : { name: name == null ? "" : availableTaskName(name, input.existingNames) }),
  };
}

/** Requires review when saving a new or materially changed active schedule; manual tasks do not run on save. */
export function requiresScheduleReview(previous: Task | null, values: TaskFormValues): boolean {
  if (values.enabled === false || values.schedule.trim() === "") {
    return false;
  }
  if (previous == null || previous.enabled === false) {
    return true;
  }
  return (
    values.schedule.trim() !== previous.schedule ||
    values.commandLine.trim() !== formatCommandLine(previous.command) ||
    values.timeoutInSeconds !== previous.timeoutInSeconds
  );
}
