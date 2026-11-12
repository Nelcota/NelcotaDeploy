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

type ContainerExecDocker = Pick<DockerEngine, "execInContainer" | "readContainerEnvironment">;

type TaskRunnerDependencies = {
  readonly database: Database;
  /** Docker of a server; the task runs where the project's current container is. */
  readonly dockerOf: (serverId: string) => ContainerExecDocker;
  readonly secretBox: SecretBox;
};

type ContainerCommandChange = {
  readonly status: "running" | "succeeded" | "failed";
  readonly output?: string;
  readonly exitCode?: number | null;
  readonly errorMessage?: string | null;
};

type ContainerCommandRun = {
  readonly projectId: string;
  readonly command: readonly string[];
  readonly timeoutInSeconds: number;
  readonly signal: AbortSignal;
  readonly missingContainerMessage: string;
  readonly onOutput?: (output: string) => void;
  readonly record: (change: ContainerCommandChange) => void;
};

/**
 * Runs a task execution inside the project's current container.
 *
 * @remarks
 * The command runs through `docker exec` as an argument vector. A POSIX shell inside the
 * container supervises its process tree for timeout and cancellation, without evaluating
 * the arguments as shell source. Images need `sh` and Linux procfs for task execution.
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
  return await runInLiveContainer(dependencies, {
    projectId: execution.projectId,
    command: execution.command,
    timeoutInSeconds: execution.timeoutInSeconds,
    signal,
    missingContainerMessage: "The project has no deployed container to run the task in",
    record: (change) => updateTaskExecution(database, executionId, change),
  });
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
  let flushedAt = 0;
  return await runInLiveContainer(dependencies, {
    projectId: queued.projectId,
    command: ["sh", "-c", queued.command],
    timeoutInSeconds: CONSOLE_TIMEOUT_IN_SECONDS,
    signal,
    missingContainerMessage: "The project has no live container",
    onOutput: (output) => {
      // At most one write a second, so a chatty command does not flood the database.
      if (Date.now() - flushedAt >= MILLISECONDS_PER_SECOND) {
        flushedAt = Date.now();
        updateConsoleCommand(database, commandId, { status: "running", output });
      }
    },
    record: (change) => updateConsoleCommand(database, commandId, change),
  });
}

async function runInLiveContainer(
  dependencies: TaskRunnerDependencies,
  run: ContainerCommandRun,
): Promise<"succeeded" | "failed"> {
  const { database } = dependencies;
  let redact = (text: string) => text;
  let output = "";
  try {
    const project = getProject(database, run.projectId);
    const container = currentContainer(database, project.currentDeploymentId);
    if (container == null) {
      run.record({ status: "failed", errorMessage: run.missingContainerMessage });
      return "failed";
    }
    const docker = dependencies.dockerOf(container.serverId);
    redact = await secretRedactor(dependencies, { project, container, docker });
    run.record({ status: "running" });
    const result = await docker.execInContainer(container.containerName, run.command, {
      timeoutInMs: run.timeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal: run.signal,
      onLine: (line) => {
        output = `${output}${redact(line)}\n`.slice(-MAX_OUTPUT_LENGTH);
        run.onOutput?.(output);
      },
    });
    const status = result.exitCode === 0 ? "succeeded" : "failed";
    run.record({
      status,
      output,
      exitCode: result.exitCode,
      errorMessage: describeFailure(result, run.timeoutInSeconds),
    });
    return status;
  } catch (error) {
    run.record({
      status: "failed",
      output,
      errorMessage: redact(error instanceof Error ? error.message : String(error)),
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
    readonly docker: ContainerExecDocker;
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
