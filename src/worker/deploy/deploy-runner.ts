import type { Database } from "@/db";
import {
  completeDeployment,
  getDeployment,
  isCancellationRequested,
  isTerminalStatus,
  transitionDeployment,
} from "@/deployments";
import { getProject } from "@/projects";

import { DeploymentCancelledError } from "../worker.errors";
import { discardFailedContainer, pruneOldImages, removePreviousContainers } from "./deploy-cleanup";
import {
  type DeployContext,
  type DeployRunnerDependencies,
  DeployState,
  errorMessageOf,
} from "./deploy-context";
import { deploy } from "./deploy-steps";
import { DeploymentLogWriter } from "./deployment-log-writer";

const CANCEL_POLL_INTERVAL_IN_MS = 1000;

type DeploymentOutcome = "succeeded" | "failed" | "cancelled" | "skipped";

function watchCancellation(
  database: Database,
  deploymentId: string,
  controller: AbortController,
): Disposable {
  const timer = setInterval(() => {
    if (isCancellationRequested(database, deploymentId)) {
      controller.abort();
    }
  }, CANCEL_POLL_INTERVAL_IN_MS);
  return { [Symbol.dispose]: () => clearInterval(timer) };
}

/**
 * Runs one deployment end to end: clone, build, start, health check, switch traffic.
 *
 * @remarks
 * The previous container keeps serving until the new one passes its health check; only
 * then are older containers of the project removed. When anything fails, the new container
 * is removed and the previous one is left untouched. Both containers are attached to the
 * proxy for a moment during the switch, so requests may briefly reach either version.
 *
 * @param dependencies - Database, Docker, git, encryption and settings.
 * @param deploymentId - Deployment to run.
 * @param jobSignal - Aborted when the worker shuts down.
 * @returns The final deployment status.
 */
export async function runDeployment(
  dependencies: DeployRunnerDependencies,
  deploymentId: string,
  jobSignal: AbortSignal,
): Promise<DeploymentOutcome> {
  const { database } = dependencies;
  const deployment = getDeployment(database, deploymentId);
  if (isTerminalStatus(deployment.status)) {
    return "skipped";
  }
  if (deployment.status !== "queued") {
    // A retried job after a worker crash: start the deployment over from the queue state.
    transitionDeployment(database, deploymentId, { to: "queued" });
  }
  const project = getProject(database, deployment.projectId);
  const cancellation = new AbortController();
  using logs = new DeploymentLogWriter(database, deploymentId);
  using _cancellationWatch = watchCancellation(database, deploymentId, cancellation);
  const context: DeployContext = {
    deployment,
    project,
    logs,
    signal: AbortSignal.any([cancellation.signal, jobSignal]),
    state: new DeployState(),
  };

  try {
    await deploy(dependencies, context);
    await finishDeployment(dependencies, context);
    return "succeeded";
  } catch (error) {
    const cancelled = cancellation.signal.aborted || error instanceof DeploymentCancelledError;
    await recordFailure(dependencies, context, { error, cancelled });
    if (jobSignal.aborted && cancelled === false) {
      throw error;
    }
    return cancelled ? "cancelled" : "failed";
  }
}

async function finishDeployment(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
): Promise<void> {
  const { deployment, project, logs } = context;
  // Readers end the live stream on a terminal status, so pending lines go out first.
  logs.flush();
  completeDeployment(dependencies.database, deployment.id);
  logs.system("Deployment succeeded");
  await removePreviousContainers(dependencies, logs, {
    projectId: project.id,
    currentDeploymentId: deployment.id,
    previewId: deployment.previewId,
  });
  await pruneOldImages(
    dependencies,
    { projectId: project.id, previewId: deployment.previewId },
    logs,
  );
}

async function recordFailure(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  { error, cancelled }: { readonly error: unknown; readonly cancelled: boolean },
): Promise<void> {
  const { deployment, logs, state } = context;
  await discardFailedContainer(dependencies.docker, state.containerName, logs);
  const message = cancelled
    ? "Deployment cancelled by a user"
    : state.redact(errorMessageOf(error));
  logs.system(message, "error");
  logs.flush();
  transitionDeployment(dependencies.database, deployment.id, {
    to: cancelled ? "cancelled" : "failed",
    errorMessage: message,
  });
}
