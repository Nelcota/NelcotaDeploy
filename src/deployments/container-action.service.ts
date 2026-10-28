import { type Actor, recordAuditEvent } from "@/audit";
import type { Database } from "@/db";
import { enqueueJob } from "@/jobs";
import { getProject } from "@/projects";

import { NoActiveContainerError } from "./deployment.errors";

/** Lifecycle operations on a project's current container. */
export const CONTAINER_ACTIONS = ["start", "stop", "restart"] as const;

export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

/**
 * Queues a start, stop or restart of the project's current container.
 *
 * @remarks
 * The web process has no Docker access, so the worker performs the action. Repeated
 * clicks while the same action is still pending return the pending job.
 *
 * @param database - Database.
 * @param request - Project, action and actor.
 * @returns The job id and whether it was newly queued.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {NoActiveContainerError} When the project was never deployed successfully.
 */
export function requestContainerAction(
  database: Database,
  request: { readonly projectId: string; readonly action: ContainerAction; readonly actor: Actor },
): { jobId: string; created: boolean } {
  return database.transaction((transaction) => {
    const project = getProject(transaction, request.projectId);
    if (project.currentDeploymentId == null) {
      throw new NoActiveContainerError(project.id);
    }
    const job = enqueueJob(transaction, {
      kind: "container_action",
      projectId: project.id,
      deploymentId: project.currentDeploymentId,
      payload: { action: request.action },
      dedupeKey: `container:${project.id}:${request.action}`,
    });
    if (job.created) {
      recordAuditEvent(transaction, {
        actor: request.actor,
        action: `container.${request.action}`,
        targetType: "project",
        targetId: project.id,
      });
    }
    return { jobId: job.id, created: job.created };
  });
}

/**
 * Narrows a job payload value to a container action.
 *
 * @param value - Value read from a job payload.
 * @returns True when it is a known action.
 */
export function isContainerAction(value: unknown): value is ContainerAction {
  return CONTAINER_ACTIONS.some((action) => action === value);
}
