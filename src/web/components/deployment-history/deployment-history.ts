import type { DeploymentStatus } from "@/deployments";
import { dayKey } from "@/shared/format";
import type { PageCursor } from "@/shared/pagination";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
} from "@/web/components/layout/labels";

/** Deploys fetched per "load more" page. */
export const PAGE_SIZE = 25;
const ACTIVE_REFRESH_INTERVAL_IN_MS = 5000;
const IDLE_REFRESH_INTERVAL_IN_MS = 15_000;
const SHORT_SHA_LENGTH = 7;

export const ALL_STATUSES = "all";
export const STATUS_FILTERS = [
  { value: ALL_STATUSES, label: "Todos" },
  { value: "active", label: "Em andamento" },
  { value: "queued", label: DEPLOYMENT_STATUS_LABELS.queued },
  { value: "succeeded", label: "Concluídos" },
  { value: "failed", label: "Falharam" },
  { value: "cancelled", label: "Cancelados" },
] as const satisfies readonly {
  readonly value: DeploymentStatus | "active" | typeof ALL_STATUSES;
  readonly label: string;
}[];

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

/**
 * Finds the cursor of the next page: the creation time and id of the oldest deploy on a full page.
 *
 * @param lastPage - The page just loaded, newest first.
 * @returns The `before` cursor, or undefined when the page was the last one.
 */
export function nextPageCursor(lastPage: readonly PageCursor[]): PageCursor | undefined {
  if (lastPage.length < PAGE_SIZE) {
    return undefined;
  }
  const last = lastPage.at(-1);
  return last == null ? undefined : { createdAt: last.createdAt, id: last.id };
}

/**
 * Chooses a faster cadence for active deploys while still discovering new deploys when idle.
 *
 * @param rows - Every loaded deploy.
 * @returns The refetch interval in milliseconds.
 */
export function historyRefreshInterval(
  rows: readonly { readonly status: DeploymentStatus }[],
): number {
  if (rows.some((row) => ACTIVE_DEPLOYMENT_STATUSES.has(row.status))) {
    return ACTIVE_REFRESH_INTERVAL_IN_MS;
  }
  return IDLE_REFRESH_INTERVAL_IN_MS;
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
