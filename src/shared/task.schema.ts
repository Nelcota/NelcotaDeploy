import { z } from "zod";

import { CommandLineParseError, parseCommandLine } from "./command-line";

const MAX_TASK_NAME_LENGTH = 64;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_COMMAND_LINE_LENGTH = 8192;
const MAX_TIMEOUT_IN_SECONDS = 3600;
const MAX_SCHEDULE_LENGTH = 100;

/** Upper bound for a task run, so a stuck command cannot hold the project forever. */
export const DEFAULT_TASK_TIMEOUT_IN_SECONDS = 300;

export const taskInputSchema = z
  .object({
    name: z
      .string()
      .transform((value) => value.normalize("NFC").trim())
      .pipe(z.string().min(1, "Campo obrigatório").max(MAX_TASK_NAME_LENGTH)),
    commandLine: z.string().max(MAX_COMMAND_LINE_LENGTH, "Comando muito longo"),
    schedule: z
      .string()
      .trim()
      .max(MAX_SCHEDULE_LENGTH)
      .transform((value) => (value === "" ? null : value)),
    enabled: z.boolean(),
    timeoutInSeconds: z.coerce
      .number()
      .int()
      .min(1, "Mínimo de 1 segundo")
      .max(MAX_TIMEOUT_IN_SECONDS, `Máximo de ${MAX_TIMEOUT_IN_SECONDS} segundos`),
  })
  .transform((input, context) => {
    const command = parseTaskCommand(input.commandLine);
    if (typeof command === "string") {
      context.addIssue({ code: "custom", message: command, path: ["commandLine"] });
      return z.NEVER;
    }
    return {
      name: input.name,
      command,
      schedule: input.schedule,
      enabled: input.enabled,
      timeoutInSeconds: input.timeoutInSeconds,
    };
  });

export type TaskInput = z.output<typeof taskInputSchema>;

/**
 * Parses and limits a task command line.
 *
 * @param commandLine - Command typed by the user.
 * @returns The argument vector, or an error message in Portuguese for the form.
 */
function parseTaskCommand(commandLine: string): string[] | string {
  let args: string[];
  try {
    args = parseCommandLine(commandLine);
  } catch (error) {
    if (error instanceof CommandLineParseError) {
      return "Aspas ou barra invertida sem fechamento no comando";
    }
    throw error;
  }
  if (args.length === 0) {
    return "Informe o comando";
  }
  if (args.length > MAX_ARGS) {
    return `Máximo de ${MAX_ARGS} argumentos`;
  }
  if (args.some((arg) => arg.length > MAX_ARG_LENGTH || arg.includes("\0"))) {
    return "Argumento inválido ou muito longo";
  }
  return args;
}
