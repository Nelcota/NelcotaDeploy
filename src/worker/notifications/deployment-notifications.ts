import { notify } from "@/alerts";
import { type Deployment, getDeployment, isTerminalStatus } from "@/deployments";
import { reportCommitStatus } from "@/github";
import { getPreview, previewHostname } from "@/previews";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";

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
 * Where the commit status links to: the preview itself once it is live, so the pull request
 * opens the running app, and the deployment page otherwise.
 */
function statusLink(
  dependencies: NotificationDependencies,
  deployment: Deployment,
  target: {
    readonly slug: string;
    readonly pullRequestNumber: number | null;
    readonly succeeded: boolean;
  },
): string {
  const settings = getSystemSettings(dependencies.database);
  if (
    target.pullRequestNumber == null ||
    target.succeeded === false ||
    settings.baseDomain == null
  ) {
    return deploymentLink(dependencies, deployment);
  }
  const hostname = previewHostname(target.slug, target.pullRequestNumber, settings.baseDomain);
  const scheme = settings.httpsByDefault ? "https" : "http";
  return `${scheme}://${hostname}`;
}

/**
 * The commit to report on, or null when there is nothing to say: the commit is not known yet,
 * a redeploy or rollback says nothing new about it, or a retried job found the deployment
 * already finished and must not mark it as running again.
 */
function reportableCommit(deployment: Deployment, state: CommitState): string | null {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  if (sha == null || deployment.trigger === "redeploy" || deployment.trigger === "rollback") {
    return null;
  }
  if (state === "pending" && isTerminalStatus(deployment.status)) {
    return null;
  }
  return sha;
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
  const sha = reportableCommit(deployment, state);
  if (sha == null) {
    return;
  }
  const project = getProject(database, deployment.projectId);
  const preview = deployment.previewId == null ? null : getPreview(database, deployment.previewId);
  try {
    await reportCommitStatus(database, secretBox, {
      fullName: project.repositoryFullName,
      sha,
      state,
      description: DESCRIPTIONS[state],
      targetUrl: statusLink(dependencies, deployment, {
        slug: project.slug,
        pullRequestNumber: preview?.pullRequestNumber ?? null,
        succeeded: state === "success",
      }),
      // Previews get their own check, so a pull request shows both builds apart.
      context: `Nelcota Deploy (${project.slug})${preview == null ? "" : " · preview"}`,
    });
  } catch (error) {
    logger.warn({ err: error, deploymentId, state }, "could not publish the commit status");
  }
}
