import { and, desc, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/audit";
import { type Database, tables } from "@/db";
import { getProject } from "@/projects";

import { requestDeployment } from "./deployment-request.service";
import { ACTIVE_STATUSES } from "./deployment-status";
import { deploymentScope } from "./preview-scope";
import { buildConfigFingerprint, hasPendingRuntimeChanges } from "./runtime-config";

type ApplyContext = { readonly actor: Actor; readonly triggeredByUserId: string | null };

/**
 * Finds the latest production deployment that can pick up pending runtime changes.
 *
 * @param database - Database.
 * @param projectId - Project whose deployment is being followed.
 * @returns The active deployment identity and status, or null when production is idle.
 */
export function getActiveRuntimeDeployment(database: Database, projectId: string) {
  return (
    database
      .select({ id: tables.deployments.id, status: tables.deployments.status })
      .from(tables.deployments)
      .where(
        and(
          eq(tables.deployments.projectId, projectId),
          // Previews run their own containers; they never hold back production changes.
          deploymentScope(null),
          inArray(tables.deployments.status, ACTIVE_STATUSES),
        ),
      )
      .orderBy(desc(tables.deployments.createdAt), desc(tables.deployments.id))
      .limit(1)
      .get() ?? null
  );
}

function liveRevision(database: Database, deploymentId: string) {
  return database
    .select({
      commitSha: tables.deployments.commitSha,
      commitMessage: tables.deployments.commitMessage,
      buildConfigHash: tables.deployments.buildConfigHash,
    })
    .from(tables.deployments)
    .where(eq(tables.deployments.id, deploymentId))
    .get();
}

/**
 * Applies saved variables and domains to the live application: recreates the container from
 * its image, or builds the live commit again when a build variable changed, since only a build
 * passes those to the image.
 *
 * @param database - Database.
 * @param projectId - Project whose configuration changed.
 * @param context - Who asked, for the audit log.
 * @returns The queued deployment id, or null when the project has nothing live or nothing new.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {ProjectNotApprovedError} When an admin has not approved the project.
 */
export function applyPendingChanges(
  database: Database,
  projectId: string,
  context: ApplyContext,
): string | null {
  const project = getProject(database, projectId);
  if (
    project.currentDeploymentId == null ||
    hasPendingRuntimeChanges(database, projectId) === false
  ) {
    return null;
  }
  const live = liveRevision(database, project.currentDeploymentId);
  // Deployments from before build fingerprints have none; they are recreated as before.
  const buildChanged =
    live?.buildConfigHash != null &&
    live.buildConfigHash !== buildConfigFingerprint(database, projectId);
  const request = { projectId, trigger: "redeploy" as const, ...context };
  if (buildChanged && live.commitSha != null) {
    return requestDeployment(database, {
      ...request,
      commitSha: live.commitSha,
      commitMessage: live.commitMessage,
    }).deploymentId;
  }
  return requestDeployment(database, {
    ...request,
    sourceDeploymentId: project.currentDeploymentId,
  }).deploymentId;
}

/**
 * Applies saved variables and domains on its own when the project asks for it.
 *
 * @remarks
 * Nothing is queued while another deployment is queued or running: it either picks up the
 * new configuration when it starts, or the worker calls this again once it finishes. A new
 * request there would also cancel a queued build or roll back the image a running one ships.
 *
 * @param database - Database.
 * @param projectId - Project whose configuration changed.
 * @param context - Who changed it, for the audit log.
 * @returns The queued deployment id, or null when there was nothing to apply.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function applyRuntimeChanges(
  database: Database,
  projectId: string,
  context: ApplyContext,
): string | null {
  const project = getProject(database, projectId);
  if (project.autoApplyChanges === false || project.deploymentsApproved === false) {
    return null;
  }
  if (getActiveRuntimeDeployment(database, projectId) != null) {
    return null;
  }
  return applyPendingChanges(database, projectId, context);
}
