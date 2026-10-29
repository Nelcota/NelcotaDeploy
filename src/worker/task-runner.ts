import type { Database } from "@/db";
import { getDeployment } from "@/deployments";
import type { DockerEngine } from "@/docker";
import { resolveEnvironment } from "@/environments";
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
  const environment = await resolveEnvironment(database, dependencies.secretBox, {
    projectId: project.id,
  });
  updateTaskExecution(database, executionId, { status: "running" });
  return await executeInContainer(
    { database, docker: dependencies.dockerOf(container.serverId) },
    {
      execution: { ...execution, id: executionId },
      containerName: container.containerName,
      redact: createRedactor(environment.secretValues),
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
      errorMessage: error instanceof Error ? error.message : String(error),
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
    return `Task exceeded its ${timeoutInSeconds}s timeout and was stopped`;
  }
  if (result.aborted) {
    return "Task interrupted because the worker is shutting down";
  }
  return result.exitCode === 0 ? null : `Command exited with code ${result.exitCode}`;
}
