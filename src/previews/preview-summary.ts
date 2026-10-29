import { desc, inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { SystemSettings } from "@/shared/schemas/settings.schema";

import { previewHostname } from "./preview-address";
import { listActivePreviews } from "./preview.service";

type DeploymentStatus = (typeof tables.deployments.$inferSelect)["status"];

/** An active preview as the project page shows it. */
export type PreviewSummary = {
  readonly id: string;
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly headSha: string;
  /** Address of the running preview; null until its first deployment succeeds. */
  readonly url: string | null;
  /** The newest deployment of the preview, whatever its state. */
  readonly latestDeployment: { readonly id: string; readonly status: DeploymentStatus } | null;
};

/**
 * Lists a project's active previews with their address and newest deployment, in one query
 * for all the deployments.
 *
 * @param database - Database.
 * @param project - Project id and slug.
 * @param settings - System settings, for the base domain and HTTPS.
 * @returns The previews, newest pull request first.
 */
export function summarizePreviews(
  database: Database,
  project: { readonly id: string; readonly slug: string },
  settings: Pick<SystemSettings, "baseDomain" | "httpsByDefault">,
): PreviewSummary[] {
  const previews = listActivePreviews(database, project.id);
  if (previews.length === 0) {
    return [];
  }
  const deployments = database
    .select({
      id: tables.deployments.id,
      previewId: tables.deployments.previewId,
      status: tables.deployments.status,
    })
    .from(tables.deployments)
    .where(
      inArray(
        tables.deployments.previewId,
        previews.map((preview) => preview.id),
      ),
    )
    .orderBy(desc(tables.deployments.createdAt), desc(tables.deployments.id))
    .all();
  const latest = new Map<string, { id: string; status: DeploymentStatus }>();
  for (const deployment of deployments) {
    if (deployment.previewId != null && latest.has(deployment.previewId) === false) {
      latest.set(deployment.previewId, { id: deployment.id, status: deployment.status });
    }
  }
  const scheme = settings.httpsByDefault ? "https" : "http";
  return previews.map((preview) => ({
    id: preview.id,
    pullRequestNumber: preview.pullRequestNumber,
    branch: preview.branch,
    headSha: preview.headSha,
    url:
      preview.currentDeploymentId == null || settings.baseDomain == null
        ? null
        : `${scheme}://${previewHostname(project.slug, preview.pullRequestNumber, settings.baseDomain)}`,
    latestDeployment: latest.get(preview.id) ?? null,
  }));
}
