import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import type { RecoveredJob } from "@/jobs";
import { ProjectNotFoundError } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { recoverConsoleJob } from "./console-recovery.service";
import {
  ConsoleBusyError,
  ConsoleCommandNotFoundError,
  ConsoleUnavailableError,
  InvalidConsoleCommandError,
} from "./console.errors";
import {
  getConsoleCommandForRun,
  listConsoleCommands,
  MAX_CONSOLE_COMMAND_LENGTH,
  MAX_CONSOLE_OUTPUT_LENGTH,
  parseConsoleCommand,
  runConsoleCommand,
  updateConsoleCommand,
} from "./console.service";

const CREATED_AT = new Date("2026-11-02T12:00:00Z");

function insertUser(database: Database, id: string): string {
  database
    .insert(tables.users)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  return id;
}

/** A project with a live deployment, so the console has a container to run in. */
function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const deploymentId = crypto.randomUUID();
  database
    .insert(tables.deployments)
    .values({
      id: deploymentId,
      projectId: project.id,
      trigger: "manual",
      triggeredByLabel: "test",
      branch: "main",
      status: "succeeded",
      createdAt: CREATED_AT.toISOString(),
    })
    .run();
  database
    .update(tables.projects)
    .set({ currentDeploymentId: deploymentId })
    .where(eq(tables.projects.id, project.id))
    .run();
  const ana = insertUser(database, "ana");
  const bruno = insertUser(database, "bruno");
  const run = (userId: string, command = "ls -la") =>
    runConsoleCommand(database, { projectId: project.id, command, userId, actor: TEST_ACTOR });
  return { database, project, ana, bruno, run };
}

describe("parseConsoleCommand", () => {
  test("trims the command", () => {
    expect(parseConsoleCommand("  ls -la  ")).toBe("ls -la");
  });

  test("keeps tabs, quotes and pipes, which the shell in the container reads", () => {
    expect(parseConsoleCommand("echo 'a\tb' | wc -c")).toBe("echo 'a\tb' | wc -c");
  });

  test.each([[""], ["   "]])("throws InvalidConsoleCommandError for %p", (raw) => {
    expect(() => parseConsoleCommand(raw)).toThrow(InvalidConsoleCommandError);
  });

  test("throws InvalidConsoleCommandError for a command longer than the limit", () => {
    expect(() => parseConsoleCommand("a".repeat(MAX_CONSOLE_COMMAND_LENGTH + 1))).toThrow(
      InvalidConsoleCommandError,
    );
  });

  test("accepts a command exactly at the limit", () => {
    expect(parseConsoleCommand("a".repeat(MAX_CONSOLE_COMMAND_LENGTH))).toHaveLength(
      MAX_CONSOLE_COMMAND_LENGTH,
    );
  });

  test.each([["ls\nrm -rf /"], ["ls\u0000"], ["ls\u001b[2J"], ["ls\u007f"]])(
    "throws InvalidConsoleCommandError for control characters in %p",
    (raw) => {
      expect(() => parseConsoleCommand(raw)).toThrow(InvalidConsoleCommandError);
    },
  );
});

describe("runConsoleCommand", () => {
  test("queues the command, its job and an audit event with the text typed", () => {
    const { database, ana, run } = setup();

    const queued = run(ana, "  php artisan migrate  ");

    expect(queued).toMatchObject({ command: "php artisan migrate", status: "queued" });
    const job = database
      .select({ kind: tables.jobs.kind, payload: tables.jobs.payload })
      .from(tables.jobs)
      .get();
    expect(job).toEqual({ kind: "console_command", payload: { commandId: queued.id } });
    const audit = database
      .select({ action: tables.auditEvents.action, metadata: tables.auditEvents.metadata })
      .from(tables.auditEvents)
      .where(eq(tables.auditEvents.action, "console.command"))
      .get();
    expect(audit?.metadata).toMatchObject({ command: "php artisan migrate" });
  });

  test("throws ConsoleBusyError while the same person has a command waiting", () => {
    const { ana, run } = setup();
    run(ana);

    expect(() => run(ana)).toThrow(ConsoleBusyError);
  });

  test("lets another person run a command meanwhile", () => {
    const { ana, bruno, run } = setup();
    run(ana);

    expect(run(bruno).status).toBe("queued");
  });

  test("lets the same person run again once the command finished", () => {
    const { database, ana, run } = setup();
    const first = run(ana);
    updateConsoleCommand(database, first.id, { status: "succeeded", exitCode: 0 });

    expect(run(ana).status).toBe("queued");
  });

  test("throws ConsoleUnavailableError for a project that was never deployed", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const ana = insertUser(database, "ana");

    expect(() =>
      runConsoleCommand(database, {
        projectId: project.id,
        command: "ls",
        userId: ana,
        actor: TEST_ACTOR,
      }),
    ).toThrow(ConsoleUnavailableError);
  });

  test("throws ProjectNotFoundError for a project that does not exist", () => {
    const { database, ana } = setup();

    expect(() =>
      runConsoleCommand(database, {
        projectId: "missing",
        command: "ls",
        userId: ana,
        actor: TEST_ACTOR,
      }),
    ).toThrow(ProjectNotFoundError);
  });
});

describe("listConsoleCommands", () => {
  test("shows each person only their own commands, oldest first", () => {
    const { database, project, ana, bruno, run } = setup();
    const first = run(ana, "pwd");
    updateConsoleCommand(database, first.id, { status: "succeeded", exitCode: 0 });
    run(ana, "ls");
    run(bruno, "whoami");

    const commands = listConsoleCommands(database, { projectId: project.id, userId: ana });

    expect(commands.map((command) => command.command)).toEqual(["pwd", "ls"]);
  });
});

describe("updateConsoleCommand", () => {
  test("preserves the start time while flushing command output", () => {
    const { database, ana, run } = setup();
    const queued = run(ana);
    const startedAt = "2026-11-02T12:00:00Z";
    database
      .update(tables.consoleCommands)
      .set({ startedAt, status: "running" })
      .where(eq(tables.consoleCommands.id, queued.id))
      .run();

    updateConsoleCommand(database, queued.id, { status: "running", output: "progress" });

    const stored = database
      .select({ startedAt: tables.consoleCommands.startedAt })
      .from(tables.consoleCommands)
      .where(eq(tables.consoleCommands.id, queued.id))
      .get();
    expect(stored?.startedAt).toBe(startedAt);
  });

  test("keeps only the end of a very long output", () => {
    const { database, ana, run } = setup();
    const queued = run(ana);

    updateConsoleCommand(database, queued.id, {
      status: "succeeded",
      output: `${"x".repeat(MAX_CONSOLE_OUTPUT_LENGTH)}end`,
    });

    const [stored] = listConsoleCommands(database, {
      projectId: getConsoleCommandForRun(database, queued.id).projectId,
      userId: ana,
    });
    expect(stored?.output).toHaveLength(MAX_CONSOLE_OUTPUT_LENGTH);
    expect(stored?.output.endsWith("end")).toBe(true);
    expect(stored?.finishedAt).not.toBeNull();
  });
});

describe("getConsoleCommandForRun", () => {
  test("throws ConsoleCommandNotFoundError for a command that does not exist", () => {
    const { database } = setup();

    expect(() => getConsoleCommandForRun(database, "missing")).toThrow(ConsoleCommandNotFoundError);
  });
});

function recoveredConsoleJob(commandId: unknown, outcome: RecoveredJob["outcome"]): RecoveredJob {
  return {
    id: "recovered",
    kind: "console_command",
    payload: { commandId },
    deploymentId: null,
    taskExecutionId: null,
    outcome,
  };
}

test.each([
  ["running", "failed", "failed"],
  ["running", "requeued", "failed"],
  ["queued", "failed", "failed"],
  ["queued", "requeued", "queued"],
  ["succeeded", "failed", "succeeded"],
] as const)("recovers a %s console command after its job is %s", (status, outcome, expected) => {
  const { database, project, ana, run } = setup();
  using _connection = database.$client;
  const queued = run(ana);
  updateConsoleCommand(database, queued.id, { status, output: "Saved output" });

  recoverConsoleJob(database, recoveredConsoleJob(queued.id, outcome));

  expect(getConsoleCommandForRun(database, queued.id).status).toBe(expected);
  expect(
    listConsoleCommands(database, {
      projectId: project.id,
      userId: ana,
    })[0]?.output,
  ).toBe("Saved output");
  if (expected === "failed") {
    expect(run(ana).status).toBe("queued");
  }
});

test.each([undefined, null, "", "  ", 0])(
  "rejects a recovered console job with invalid target %p",
  (commandId) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;

    expect(() => recoverConsoleJob(database, recoveredConsoleJob(commandId, "failed"))).toThrow(
      "has no command id",
    );
  },
);
