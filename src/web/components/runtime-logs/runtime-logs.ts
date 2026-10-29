import type { listDeploymentsFn } from "@/web/functions/deployments.functions";

/** Picker value that streams every recent deploy instead of a single one. */
export const ALL_DEPLOYMENTS = "all";
const SHORT_SHA_LENGTH = 7;

export type DeploymentItem = Awaited<ReturnType<typeof listDeploymentsFn>>[number];

/**
 * Builds the runtime-logs stream URL for one deploy, or for all recent ones.
 *
 * @param projectId - Project whose container logs to stream.
 * @param selected - A deployment id, or {@link ALL_DEPLOYMENTS}.
 * @returns The same-origin path of the server-sent events stream.
 */
export function runtimeLogsUrl(projectId: string, selected: string): string {
  const base = `/api/projects/${projectId}/runtime-logs`;
  if (selected === ALL_DEPLOYMENTS) {
    return base;
  }
  return `${base}?deploymentId=${encodeURIComponent(selected)}`;
}

/**
 * Short label of a deploy: its commit, or the end of its id while the commit is unknown.
 *
 * @param deployment - Deploy shown in the picker.
 * @returns Seven characters identifying the deploy.
 */
export function shortShaOf(
  deployment: Pick<DeploymentItem, "id" | "commitSha" | "requestedCommitSha">,
): string {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  if (sha == null) {
    return deployment.id.slice(-SHORT_SHA_LENGTH);
  }
  return sha.slice(0, SHORT_SHA_LENGTH);
}
