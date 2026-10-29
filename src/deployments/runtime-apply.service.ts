import { and, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/audit";
import { type Database, tables } from "@/db";
import { getProject } from "@/projects";

import { requestDeployment } from "./deployment-request.service";
import { ACTIVE_STATUSES } from "./deployment-status";
import { hasPendingRuntimeChanges } from "./runtime-config";

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

/**
 * Recreates the live container when its variables or domains changed and the project applies
 * changes automatically.
 *
 * @remarks
 * Nothing is queued while another deployment is queued or running: it either picks up the
 * new configuration when it starts, or the worker calls this again once it finishes. A new
 * request there would also cancel a queued build or roll back the image a running one ships.
 *
 * @param database - Database.
 * @param projectId - Project whose configuration changed.
 * @param context - Who changed it, for the audit log.
 * @returns The queued redeploy id, or null when there was nothing to apply.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function applyRuntimeChanges(
  database: Database,
  projectId: string,
  context: { readonly actor: Actor; readonly triggeredByUserId: string | null },
): string | null {
  const project = getProject(database, projectId);
  if (project.autoApplyChanges === false || project.deploymentsApproved === false) {
    return null;
  }
  if (project.currentDeploymentId == null || hasActiveDeployment(database, projectId)) {
    return null;
  }
  if (hasPendingRuntimeChanges(database, projectId) === false) {
    return null;
  }
  const { deploymentId } = requestDeployment(database, {
    projectId,
    trigger: "redeploy",
    actor: context.actor,
    triggeredByUserId: context.triggeredByUserId,
    sourceDeploymentId: project.currentDeploymentId,
  });
  return deploymentId;
}
