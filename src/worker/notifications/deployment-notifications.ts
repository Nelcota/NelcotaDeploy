import { notify } from "@/alerts";
import { type Deployment, getDeployment, isTerminalStatus } from "@/deployments";
import { reportCommitStatus } from "@/github";
import { getProject } from "@/projects";

import type { WorkerDependencies } from "../worker.types";

const SHORT_SHA_LENGTH = 7;

/** Where a deployment's outcome is shown on GitHub. */
type CommitState = "pending" | "success" | "failure" | "error";

const DESCRIPTIONS: Record<CommitState, string> = {
  pending: "Deploy em andamento",
  success: "Deploy concluído",
  failure: "Deploy falhou",
  error: "Deploy cancelado",
};

type NotificationDependencies = Pick<
  WorkerDependencies,
  "database" | "secretBox" | "config" | "logger"
>;

function deploymentLink(dependencies: NotificationDependencies, deployment: Deployment): string {
  return `${dependencies.config.PUBLIC_URL}/projects/${deployment.projectId}/deployments/${deployment.id}`;
}

/**
 * Posts a failed deployment to the alert webhook, when one is set.
 *
 * @param dependencies - Database, settings, logger and the panel's address.
 * @param deployment - The failed deployment.
 */
export async function notifyFailedDeployment(
  dependencies: NotificationDependencies,
  deployment: Deployment,
): Promise<void> {
  const commit = deployment.commitSha?.slice(0, SHORT_SHA_LENGTH);
  await notify(dependencies.database, dependencies.logger, {
    title: "Deploy falhou",
    text: `O deploy de ${deployment.projectName}${commit == null ? "" : ` (${commit})`} falhou.`,
    link: deploymentLink(dependencies, deployment),
  });
}

/**
 * Shows a deployment's state on its commit through the GitHub App. Redeploys and rollbacks
 * are skipped: they say nothing new about the commit. A failure is logged and never stops the
 * deployment.
 *
 * @param dependencies - Database, encryption, the panel's address and logger.
 * @param deploymentId - Deployment whose state changed.
 * @param state - Its state on GitHub.
 */
export async function reportDeploymentStatus(
  dependencies: NotificationDependencies,
  deploymentId: string,
  state: CommitState,
): Promise<void> {
  const { database, secretBox, logger } = dependencies;
  const deployment = getDeployment(database, deploymentId);
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  if (sha == null || deployment.trigger === "redeploy" || deployment.trigger === "rollback") {
    return;
  }
  // A job retried for a deployment that already ended must not mark its commit as running.
  if (state === "pending" && isTerminalStatus(deployment.status)) {
    return;
  }
  const project = getProject(database, deployment.projectId);
  try {
    await reportCommitStatus(database, secretBox, {
      fullName: project.repositoryFullName,
      sha,
      state,
      description: DESCRIPTIONS[state],
      targetUrl: deploymentLink(dependencies, deployment),
      context: `Nelcota Deploy (${project.slug})`,
    });
  } catch (error) {
    logger.warn({ err: error, deploymentId, state }, "could not publish the commit status");
  }
}
