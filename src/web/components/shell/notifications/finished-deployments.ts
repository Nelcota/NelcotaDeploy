import { ACTIVE_DEPLOYMENT_STATUSES } from "@/web/components/layout/labels";

type WatchedDeployment = { readonly id: string; readonly status: string };

/**
 * Picks the deployments that were running at the previous poll and have now finished, leaving
 * out the one on screen (its page announces the result) and cancellations (the user did it).
 *
 * @param previousStatuses - Status of each deployment at the previous poll, by id.
 * @param deployments - Deployments of the current poll.
 * @param viewingId - Deployment open on screen, or null.
 * @returns The deployments worth a notification, in poll order.
 */
export function findFinishedDeployments<T extends WatchedDeployment>(
  previousStatuses: ReadonlyMap<string, string>,
  deployments: readonly T[],
  viewingId: string | null,
): T[] {
  return deployments.filter((deployment) => {
    const before = previousStatuses.get(deployment.id);
    const justFinished =
      before != null &&
      ACTIVE_DEPLOYMENT_STATUSES.has(before) &&
      ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status) === false;
    return justFinished && deployment.id !== viewingId && deployment.status !== "cancelled";
  });
}
