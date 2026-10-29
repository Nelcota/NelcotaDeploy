import { and, eq, isNull, type SQL } from "drizzle-orm";

import { tables, type Transaction } from "@/db";

import { PreviewNotActiveError } from "./deployment.errors";

/**
 * Selects the deployments of one scope: production when `previewId` is null, otherwise that
 * pull request preview. Production and previews never deduplicate, supersede or reuse one
 * another's deployments.
 *
 * @param previewId - Preview id, or null for production.
 * @returns The condition on `deployments.preview_id`.
 */
export function deploymentScope(previewId: string | null): SQL {
  return previewId == null
    ? isNull(tables.deployments.previewId)
    : eq(tables.deployments.previewId, previewId);
}

/**
 * Returns the branch an active preview of the project deploys.
 *
 * @param transaction - Open transaction.
 * @param projectId - Project the preview must belong to.
 * @param previewId - Preview id.
 * @returns The pull request's branch.
 * @throws {PreviewNotActiveError} When the preview does not exist, belongs to another project
 *   or was closed.
 */
export function activePreviewBranch(
  transaction: Transaction,
  projectId: string,
  previewId: string,
): string {
  const preview = transaction
    .select({ branch: tables.previews.branch })
    .from(tables.previews)
    .where(
      and(
        eq(tables.previews.id, previewId),
        eq(tables.previews.projectId, projectId),
        eq(tables.previews.status, "active"),
      ),
    )
    .get();
  if (preview == null) {
    throw new PreviewNotActiveError(previewId);
  }
  return preview.branch;
}
