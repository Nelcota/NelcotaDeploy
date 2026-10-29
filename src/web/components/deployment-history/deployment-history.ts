import type { DeploymentStatus } from "@/deployments";
import { dayKey } from "@/shared/format";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
} from "@/web/components/layout/labels";

/** Deploys fetched per "load more" page. */
export const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const SHORT_SHA_LENGTH = 7;

export const ALL_STATUSES = "all";
// The statuses people look for in a history; the in-progress ones show up under "Todos".
export const STATUS_FILTERS = [
  { value: ALL_STATUSES, label: "Todos" },
  { value: "queued", label: DEPLOYMENT_STATUS_LABELS.queued },
  { value: "succeeded", label: "Concluídos" },
  { value: "failed", label: "Falharam" },
  { value: "cancelled", label: "Cancelados" },
] as const satisfies readonly {
  readonly value: DeploymentStatus | typeof ALL_STATUSES;
  readonly label: string;
}[];

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

/**
 * Finds the cursor of the next page: the creation time of the oldest deploy on a full page.
 *
 * @param lastPage - The page just loaded, newest first.
 * @returns The `before` cursor, or undefined when the page was the last one.
 */
export function nextPageCursor(
  lastPage: readonly { readonly createdAt: string }[],
): string | undefined {
  if (lastPage.length < PAGE_SIZE) {
    return undefined;
  }
  return lastPage.at(-1)?.createdAt;
}

/**
 * Chooses how often the history refreshes: often while a deploy is running, never otherwise.
 *
 * @param rows - Every loaded deploy.
 * @returns The refetch interval in milliseconds, or false to stop polling.
 */
export function historyRefreshInterval(
  rows: readonly { readonly status: DeploymentStatus }[],
): number | false {
  if (rows.some((row) => ACTIVE_DEPLOYMENT_STATUSES.has(row.status))) {
    return ACTIVE_REFRESH_INTERVAL_IN_MS;
  }
  return false;
}

/**
 * Short label of a deploy: its commit, or "deploy" plus the end of its id while it has none.
 *
 * @param deployment - The deploy to label.
 * @returns Seven characters of the commit, or `deploy <id end>`.
 */
export function deploymentLabel(deployment: {
  readonly id: string;
  readonly commitSha: string | null;
  readonly requestedCommitSha: string | null;
}): string {
  const sha = deployment.commitSha ?? deployment.requestedCommitSha;
  if (sha == null) {
    return `deploy ${deployment.id.slice(-SHORT_SHA_LENGTH)}`;
  }
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Groups deploys by local day, keeping their order (newest first).
 *
 * @param rows - Deploys, newest first.
 * @returns `[day, deploys]` pairs in the same order.
 */
export function groupByDay<Row extends { readonly createdAt: string }>(
  rows: readonly Row[],
): [string, Row[]][] {
  return [...Map.groupBy(rows, (row) => dayKey(row.createdAt) ?? row.createdAt)];
}

/**
 * Decides what a row shows in the rollback column.
 *
 * @param showColumn - Whether any listed deploy can be restored, so the column takes space.
 * @param isTarget - Whether this row's deploy can be restored by the current user.
 * @returns "hidden" without the column, "available" with a button, "empty" to keep alignment.
 */
export function rollbackColumnState(
  showColumn: boolean,
  isTarget: boolean,
): "hidden" | "empty" | "available" {
  if (showColumn === false) {
    return "hidden";
  }
  return isTarget ? "available" : "empty";
}
