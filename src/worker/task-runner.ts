import {
  CONSOLE_TIMEOUT_IN_SECONDS,
  getConsoleCommandForRun,
  updateConsoleCommand,
} from "@/console";
import type { Database } from "@/db";
import { getDeployment } from "@/deployments";
import type { DockerEngine } from "@/docker";
import { readDeploymentSecrets, resolveEnvironment } from "@/environments";
import { getProject } from "@/projects";
import { createRedactor, type SecretBox } from "@/secrets";
import { getExecutionForRun, updateTaskExecution } from "@/tasks";

const MILLISECONDS_PER_SECOND = 1000;
const MAX_OUTPUT_LENGTH = 65_536;

type TaskRunnerDependencies = {
  readonly database: Database;
  /** Docker of a server; the task runs where the project's current container is. */
  readonly dockerOf: (serverId: string) => DockerEngine;
  readonly secretBox: SecretBox;
};

type QueuedExecution = {
  readonly id: string;
  readonly command: readonly string[];
  readonly timeoutInSeconds: number;
};

/**
 * Runs a task execution inside the project's current container.
 *
 * @remarks
 * The command runs through `docker exec` as an argument vector: it never runs on the host
 * and never passes through a shell unless the task itself calls one inside the container.
 *
 * @param dependencies - Database, Docker and encryption box (for log redaction).
 * @param executionId - Execution to run.
 * @param signal - Aborted when the worker shuts down.
 * @returns Final status.
 */
export async function runTaskExecution(
  dependencies: TaskRunnerDependencies,
  executionId: string,
  signal: AbortSignal,
): Promise<"succeeded" | "failed" | "skipped"> {
  const { database } = dependencies;
  const execution = getExecutionForRun(database, executionId);
  if (execution?.status !== "queued") {
    return "skipped";
  }
  const project = getProject(database, execution.projectId);
  const container = currentContainer(database, project.currentDeploymentId);
  if (container == null) {
    updateTaskExecution(database, executionId, {
      status: "failed",
      errorMessage: "The project has no deployed container to run the task in",
    });
    return "failed";
  }
  const docker = dependencies.dockerOf(container.serverId);
  const redact = await secretRedactor(dependencies, { project, container, docker });
  updateTaskExecution(database, executionId, { status: "running" });
  return await executeInContainer(
    { database, docker },
    {
      execution: { ...execution, id: executionId },
      containerName: container.containerName,
      redact,
      signal,
    },
  );
}

async function executeInContainer(
  { database, docker }: { readonly database: Database; readonly docker: DockerEngine },
  run: {
    readonly execution: QueuedExecution;
    readonly containerName: string;
    readonly redact: (text: string) => string;
    readonly signal: AbortSignal;
  },
): Promise<"succeeded" | "failed"> {
  const { execution } = run;
  let output = "";
  try {
    const result = await docker.execInContainer(run.containerName, execution.command, {
      timeoutInMs: execution.timeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal: run.signal,
      onLine: (line) => {
        output = `${output}${run.redact(line)}\n`.slice(-MAX_OUTPUT_LENGTH);
      },
    });
    const status = result.exitCode === 0 ? "succeeded" : "failed";
    updateTaskExecution(database, execution.id, {
      status,
      exitCode: result.exitCode,
      output,
      errorMessage: describeFailure(result, execution.timeoutInSeconds),
    });
    return status;
  } catch (error) {
    updateTaskExecution(database, execution.id, {
      status: "failed",
      output,
      errorMessage: run.redact(error instanceof Error ? error.message : String(error)),
    });
    return "failed";
  }
}

/**
 * Hides from command output the project's secrets, both the current ones and the ones the
 * live container started with.
 */
async function secretRedactor(
  dependencies: TaskRunnerDependencies,
  target: {
    readonly project: { readonly id: string; readonly currentDeploymentId: string | null };
    readonly container: { readonly containerName: string };
    readonly docker: DockerEngine;
  },
): Promise<(text: string) => string> {
  const { database, secretBox } = dependencies;
  const environment = await resolveEnvironment(database, secretBox, {
    projectId: target.project.id,
  });
  const saved = await readDeploymentSecrets(
    database,
    secretBox,
    target.project.currentDeploymentId,
  );
  const previous =
    saved ?? (await target.docker.readContainerEnvironment(target.container.containerName));
  return createRedactor([...environment.secretValues, ...previous]);
}

/**
 * Runs a console command once in the project's live container, through `sh -c`, and stores
 * its output as it arrives, so the console shows it while the command runs.
 *
 * @remarks
 * The shell runs inside the container, never on the server. Output passes through the same
 * redaction as task output. The worker stops waiting after 60 seconds; disconnecting Docker
 * exec does not guarantee that the process inside the container has stopped.
 *
 * @param dependencies - Database, Docker and encryption box (for redaction).
 * @param commandId - Command to run.
 * @param signal - Aborted when the worker shuts down.
 * @returns Final status.
 * @throws {ConsoleCommandNotFoundError} When the command no longer exists.
 */
export async function runConsoleCommandJob(
  dependencies: TaskRunnerDependencies,
  commandId: string,
  signal: AbortSignal,
): Promise<"succeeded" | "failed" | "skipped"> {
  const { database } = dependencies;
  const queued = getConsoleCommandForRun(database, commandId);
  if (queued.status !== "queued") {
    return "skipped";
  }
  let redact = (text: string) => text;
  let output = "";
  let flushedAt = 0;
  try {
    const project = getProject(database, queued.projectId);
    const container = currentContainer(database, project.currentDeploymentId);
    if (container == null) {
      updateConsoleCommand(database, commandId, {
        status: "failed",
        errorMessage: "The project has no live container",
      });
      return "failed";
    }
    const docker = dependencies.dockerOf(container.serverId);
    redact = await secretRedactor(dependencies, { project, container, docker });
    updateConsoleCommand(database, commandId, { status: "running" });
    const result = await docker.execInContainer(
      container.containerName,
      ["sh", "-c", queued.command],
      {
        timeoutInMs: CONSOLE_TIMEOUT_IN_SECONDS * MILLISECONDS_PER_SECOND,
        signal,
        onLine: (line) => {
          output = `${output}${redact(line)}\n`.slice(-MAX_OUTPUT_LENGTH);
          // At most one write a second, so a chatty command does not flood the database.
          if (Date.now() - flushedAt >= MILLISECONDS_PER_SECOND) {
            flushedAt = Date.now();
            updateConsoleCommand(database, commandId, { status: "running", output });
          }
        },
      },
    );
    const status = result.exitCode === 0 ? "succeeded" : "failed";
    updateConsoleCommand(database, commandId, {
      status,
      output,
      exitCode: result.exitCode,
      errorMessage: describeFailure(result, CONSOLE_TIMEOUT_IN_SECONDS),
    });
    return status;
  } catch (error) {
    updateConsoleCommand(database, commandId, {
      status: "failed",
      output,
      errorMessage: redact(error instanceof Error ? error.message : String(error)),
    });
    return "failed";
  }
}

function currentContainer(
  database: Database,
  currentDeploymentId: string | null,
): { readonly containerName: string; readonly serverId: string } | null {
  if (currentDeploymentId == null) {
    return null;
  }
  const deployment = getDeployment(database, currentDeploymentId);
  if (deployment.containerName == null) {
    return null;
  }
  return { containerName: deployment.containerName, serverId: deployment.serverId };
}

function describeFailure(
  result: { readonly exitCode: number; readonly timedOut: boolean; readonly aborted: boolean },
  timeoutInSeconds: number,
): string | null {
  if (result.timedOut) {
    return `Stopped after its ${timeoutInSeconds}s timeout`;
  }
  if (result.aborted) {
    return "Interrupted because the worker is shutting down";
  }
  return result.exitCode === 0 ? null : `Command exited with code ${result.exitCode}`;
}
