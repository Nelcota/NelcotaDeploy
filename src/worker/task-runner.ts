import type { Database } from "@/db";
import { getDeployment } from "@/deployments";
import type { DockerEngine } from "@/docker";
import { resolveEnvironment } from "@/environments";
import { getProject } from "@/projects";
import { createRedactor, type SecretBox } from "@/secrets";
import { getExecutionForRun, updateTaskExecution } from "@/tasks";

const MILLISECONDS_PER_SECOND = 1000;
const MAX_OUTPUT_LENGTH = 65_536;

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
  dependencies: {
    readonly database: Database;
    readonly docker: DockerEngine;
    readonly secretBox: SecretBox;
  },
  executionId: string,
  signal: AbortSignal,
): Promise<"succeeded" | "failed" | "skipped"> {
  const { database, docker } = dependencies;
  const execution = getExecutionForRun(database, executionId);
  if (execution?.status !== "queued") {
    return "skipped";
  }
  const project = getProject(database, execution.projectId);
  const containerName =
    project.currentDeploymentId == null
      ? null
      : getDeployment(database, project.currentDeploymentId).containerName;
  if (containerName == null) {
    updateTaskExecution(database, executionId, {
      status: "failed",
      errorMessage: "The project has no deployed container to run the task in",
    });
    return "failed";
  }
  const environment = await resolveEnvironment(database, dependencies.secretBox, project.id);
  const redact = createRedactor(environment.secretValues);
  updateTaskExecution(database, executionId, { status: "running" });
  let output = "";
  try {
    const result = await docker.execInContainer(containerName, execution.command, {
      timeoutInMs: execution.timeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal,
      onLine: (line) => {
        output = `${output}${redact(line)}\n`.slice(-MAX_OUTPUT_LENGTH);
      },
    });
    const succeeded = result.exitCode === 0;
    updateTaskExecution(database, executionId, {
      status: succeeded ? "succeeded" : "failed",
      exitCode: result.exitCode,
      output,
      errorMessage: describeFailure(result, execution.timeoutInSeconds),
    });
    return succeeded ? "succeeded" : "failed";
  } catch (error) {
    updateTaskExecution(database, executionId, {
      status: "failed",
      output,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
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
