import { and, desc, eq, inArray } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import { enqueueJob } from "@/jobs";
import { getProject } from "@/projects";

import {
  ConsoleBusyError,
  ConsoleCommandNotFoundError,
  ConsoleUnavailableError,
  InvalidConsoleCommandError,
} from "./console.errors";

/** Longest command accepted, in characters. */
export const MAX_CONSOLE_COMMAND_LENGTH = 2000;
/** Most output kept per command; the rest of a long output is dropped from the start. */
export const MAX_CONSOLE_OUTPUT_LENGTH = 65_536;
/** How long a command may run before it is stopped. */
export const CONSOLE_TIMEOUT_IN_SECONDS = 60;
const HISTORY_LENGTH = 20;
const TAB = 9;
const FIRST_PRINTABLE = 32;
const DELETE = 127;

// Control characters other than tab: a NUL cuts a shell argument short, the rest only confuse.
function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < FIRST_PRINTABLE && code !== TAB) || code === DELETE) {
      return true;
    }
  }
  return false;
}

export type ConsoleCommandStatus = (typeof tables.consoleCommands.$inferSelect)["status"];

/** A command as its author sees it in the console. */
export type ConsoleCommand = {
  readonly id: string;
  readonly command: string;
  readonly status: ConsoleCommandStatus;
  readonly exitCode: number | null;
  readonly output: string;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

const commandColumns = {
  id: tables.consoleCommands.id,
  command: tables.consoleCommands.command,
  status: tables.consoleCommands.status,
  exitCode: tables.consoleCommands.exitCode,
  output: tables.consoleCommands.output,
  errorMessage: tables.consoleCommands.errorMessage,
  createdAt: tables.consoleCommands.createdAt,
  finishedAt: tables.consoleCommands.finishedAt,
};

/**
 * Checks and normalizes a command typed in the console.
 *
 * @param raw - The text typed.
 * @returns The command, trimmed.
 * @throws {InvalidConsoleCommandError} When it is empty, longer than 2000 characters or has a
 * line break or another control character.
 */
export function parseConsoleCommand(raw: string): string {
  const command = raw.normalize("NFC").trim();
  if (command === "") {
    throw new InvalidConsoleCommandError("empty");
  }
  if (command.length > MAX_CONSOLE_COMMAND_LENGTH) {
    throw new InvalidConsoleCommandError(`longer than ${MAX_CONSOLE_COMMAND_LENGTH} characters`);
  }
  if (hasControlCharacter(command)) {
    throw new InvalidConsoleCommandError("control characters are not allowed");
  }
  return command;
}

/**
 * Queues a command to run once in the project's live container and records it in the audit
 * log, with who typed it.
 *
 * @param database - Database.
 * @param request - Project, raw command, the user typing it and the audit actor.
 * @returns The queued command.
 * @throws {InvalidConsoleCommandError} When the command is not acceptable.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {ConsoleUnavailableError} When the project has no live container.
 * @throws {ConsoleBusyError} When the user already has a command waiting or running there.
 */
export function runConsoleCommand(
  database: Database,
  request: {
    readonly projectId: string;
    readonly command: string;
    readonly userId: string;
    readonly actor: Actor;
  },
): ConsoleCommand {
  const command = parseConsoleCommand(request.command);
  return database.transaction((transaction) => {
    const project = getProject(transaction, request.projectId);
    if (project.currentDeploymentId == null) {
      throw new ConsoleUnavailableError(project.id);
    }
    const active = transaction
      .select({ id: tables.consoleCommands.id })
      .from(tables.consoleCommands)
      .where(
        and(
          eq(tables.consoleCommands.projectId, project.id),
          eq(tables.consoleCommands.userId, request.userId),
          inArray(tables.consoleCommands.status, ["queued", "running"]),
        ),
      )
      .get();
    if (active != null) {
      throw new ConsoleBusyError(project.id);
    }
    const queued = {
      id: Bun.randomUUIDv7(),
      command,
      status: "queued" as const,
      exitCode: null,
      output: "",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    transaction
      .insert(tables.consoleCommands)
      .values({ ...queued, projectId: project.id, userId: request.userId })
      .run();
    enqueueJob(transaction, {
      kind: "console_command",
      projectId: project.id,
      payload: { commandId: queued.id },
    });
    recordAuditEvent(transaction, {
      actor: request.actor,
      action: "console.command",
      targetType: "project",
      targetId: project.id,
      metadata: { commandId: queued.id, command },
    });
    return queued;
  });
}

/**
 * Lists a user's latest commands on a project, oldest first, as the console shows them.
 *
 * @param database - Database.
 * @param scope - Project and the user whose commands are shown; nobody sees another's.
 * @returns Up to 20 commands.
 */
export function listConsoleCommands(
  database: Database,
  scope: { readonly projectId: string; readonly userId: string },
): ConsoleCommand[] {
  return database
    .select(commandColumns)
    .from(tables.consoleCommands)
    .where(
      and(
        eq(tables.consoleCommands.projectId, scope.projectId),
        eq(tables.consoleCommands.userId, scope.userId),
      ),
    )
    .orderBy(desc(tables.consoleCommands.createdAt), desc(tables.consoleCommands.id))
    .limit(HISTORY_LENGTH)
    .all()
    .toReversed();
}

/**
 * Reads a queued command for the worker.
 *
 * @param database - Database.
 * @param commandId - Command id from the job.
 * @returns The project, the command and its status.
 * @throws {ConsoleCommandNotFoundError} When the command no longer exists.
 */
export function getConsoleCommandForRun(
  database: Database,
  commandId: string,
): { readonly projectId: string; readonly command: string; readonly status: ConsoleCommandStatus } {
  const found = database
    .select({
      projectId: tables.consoleCommands.projectId,
      command: tables.consoleCommands.command,
      status: tables.consoleCommands.status,
    })
    .from(tables.consoleCommands)
    .where(eq(tables.consoleCommands.id, commandId))
    .get();
  if (found == null) {
    throw new ConsoleCommandNotFoundError(commandId);
  }
  return found;
}

/**
 * Records the progress or outcome of a command.
 *
 * @param database - Database.
 * @param commandId - Command id.
 * @param change - New status, output so far, exit code and failure, when known.
 */
export function updateConsoleCommand(
  database: Database,
  commandId: string,
  change: {
    readonly status: ConsoleCommandStatus;
    readonly output?: string;
    readonly exitCode?: number | null;
    readonly errorMessage?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const finished = change.status === "succeeded" || change.status === "failed";
  database
    .update(tables.consoleCommands)
    .set({
      status: change.status,
      ...(change.output == null ? {} : { output: change.output.slice(-MAX_CONSOLE_OUTPUT_LENGTH) }),
      ...(change.exitCode === undefined ? {} : { exitCode: change.exitCode }),
      ...(change.errorMessage === undefined ? {} : { errorMessage: change.errorMessage }),
      ...(change.status === "running" ? { startedAt: now } : {}),
      ...(finished ? { finishedAt: now } : {}),
    })
    .where(eq(tables.consoleCommands.id, commandId))
    .run();
}
