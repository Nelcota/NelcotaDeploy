import type { DeploymentStatus } from "@/deployments";
import { ACTIVE_DEPLOYMENT_STATUSES } from "@/web/components/layout/labels";

const SHORT_SHA_LENGTH = 7;
const SHORT_ID_LENGTH = 8;

/**
 * Tells whether a deploy is still moving through its stages.
 *
 * @param status - Current status, or undefined while it loads.
 * @returns True for queued and in-progress statuses.
 */
export function isActiveDeployment(status: DeploymentStatus | undefined): boolean {
  return status != null && ACTIVE_DEPLOYMENT_STATUSES.has(status);
}

/**
 * Short name of a deploy for its title: the commit, or the end of the id while none is known.
 *
 * @param deployment - The deploy shown.
 * @returns Seven commit characters, or eight id characters.
 */
export function deploymentTitleId(deployment: {
  readonly id: string;
  readonly commitSha: string | null;
  readonly requestedCommitSha: string | null;
}): string {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  if (sha == null) {
    return deployment.id.slice(-SHORT_ID_LENGTH);
  }
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Shortens a commit hash for display.
 *
 * @param sha - Full commit hash.
 * @returns Its first seven characters.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Picks the end time used for the duration: the real end, or "now" while the deploy runs.
 *
 * @param deployment - Start and end of the deploy.
 * @param active - Whether the deploy is still running.
 * @param now - Current time.
 * @returns A UTC ISO date, or null when the duration cannot be measured yet.
 */
export function durationEnd(
  deployment: { readonly startedAt: string | null; readonly finishedAt: string | null },
  active: boolean,
  now: Date,
): string | null {
  if (deployment.finishedAt != null) {
    return deployment.finishedAt;
  }
  if (active && deployment.startedAt != null) {
    return now.toISOString();
  }
  return null;
}

/** The one action shown beside the title, in order of urgency. */
export type HeaderAction = "cancel" | "retry" | "rollback" | null;

/**
 * Chooses the header action: cancel a running deploy, retry a failed one, or roll back to an
 * older successful one.
 *
 * @param deployment - Status, image and whether it is the live deploy.
 * @param canDeploy - Whether the user may create deploys.
 * @returns The action to show, or null.
 */
export function headerActionOf(
  deployment: {
    readonly status: DeploymentStatus;
    readonly imageTag: string | null;
    readonly isLive: boolean;
  },
  canDeploy: boolean,
): HeaderAction {
  if (canDeploy === false) {
    return null;
  }
  if (isActiveDeployment(deployment.status)) {
    return "cancel";
  }
  if (deployment.status === "failed" || deployment.status === "cancelled") {
    return "retry";
  }
  if (
    deployment.status === "succeeded" &&
    deployment.imageTag != null &&
    deployment.isLive === false
  ) {
    return "rollback";
  }
  return null;
}

/**
 * Reads the final status from the log stream's end event.
 *
 * @param summary - Payload of the end event, from the network.
 * @returns "succeeded" or "failed" when the summary says so, otherwise null.
 */
export function finalStatusOf(summary: unknown): "succeeded" | "failed" | null {
  if (typeof summary !== "object" || summary == null || "status" in summary === false) {
    return null;
  }
  const { status } = summary;
  if (status === "succeeded" || status === "failed") {
    return status;
  }
  return null;
}
