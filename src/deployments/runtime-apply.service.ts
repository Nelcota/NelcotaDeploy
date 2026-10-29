import { and, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/audit";
import { type Database, tables } from "@/db";
import { getProject } from "@/projects";

import { requestDeployment } from "./deployment-request.service";
import { ACTIVE_STATUSES } from "./deployment-status";
import { buildConfigFingerprint, hasPendingRuntimeChanges } from "./runtime-config";

type ApplyContext = { readonly actor: Actor; readonly triggeredByUserId: string | null };

function hasActiveDeployment(database: Database, projectId: string): boolean {
  const active = database
    .select({ id: tables.deployments.id })
    .from(tables.deployments)
    .where(
      and(
        eq(tables.deployments.projectId, projectId),
        inArray(tables.deployments.status, ACTIVE_STATUSES),
      ),
    )
    .get();
  return active != null;
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
  if (hasActiveDeployment(database, projectId)) {
    return null;
  }
  return applyPendingChanges(database, projectId, context);
}
