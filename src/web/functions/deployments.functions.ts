import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import {
  cancelDeployment,
  CONTAINER_ACTIONS,
  DEPLOYMENT_STATUSES,
  getDeployment,
  listDeployments,
  listRollbackCandidates,
  requestContainerAction,
  requestDeployment,
  summarizeDeployments,
} from "@/deployments";
import { getProject } from "@/projects";
import { authorize } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";

import { idSchema, projectIdInput } from "./ids";

const MAX_PAGE_SIZE = 100;
const MAX_STATS_DAYS = 30;

export const listDeploymentsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      projectId: idSchema.optional(),
      status: z.enum(DEPLOYMENT_STATUSES).optional(),
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
      before: z.iso.datetime().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listDeployments(getDatabase(), data);
  });

/** Totals, success rate, average duration and per-day counts of the last `days` days. */
export const getDeploymentStatsFn = createServerFn({ method: "GET" })
  .validator(z.object({ days: z.number().int().min(1).max(MAX_STATS_DAYS) }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return summarizeDeployments(getDatabase(), { days: data.days });
  });

export const getDeploymentFn = createServerFn({ method: "GET" })
  .validator(z.object({ deploymentId: idSchema }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return getDeployment(getDatabase(), data.deploymentId);
  });

export const deployProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorize("deployment:create");
    return requestDeployment(getDatabase(), {
      projectId: data.projectId,
      trigger: "manual",
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Recreates the container from the current image, applying new variables and domains. */
export const redeployProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorize("deployment:create");
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    if (project.currentDeploymentId == null) {
      throw new PublicError("Faça o primeiro deploy antes de usar o redeploy.");
    }
    return requestDeployment(database, {
      projectId: project.id,
      trigger: "redeploy",
      actor: userActor(user),
      triggeredByUserId: user.id,
      sourceDeploymentId: project.currentDeploymentId,
    });
  });

export const rollbackDeploymentFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, deploymentId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("deployment:create");
    return requestDeployment(getDatabase(), {
      projectId: data.projectId,
      trigger: "rollback",
      actor: userActor(user),
      triggeredByUserId: user.id,
      sourceDeploymentId: data.deploymentId,
    });
  });

export const cancelDeploymentFn = createServerFn({ method: "POST" })
  .validator(z.object({ deploymentId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("deployment:create");
    return cancelDeployment(getDatabase(), data.deploymentId, userActor(user));
  });

export const listRollbackCandidatesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listRollbackCandidates(getDatabase(), data.projectId);
  });

export const containerActionFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, action: z.enum(CONTAINER_ACTIONS) }))
  .handler(async ({ data }) => {
    const user = await authorize("container:control");
    return requestContainerAction(getDatabase(), { ...data, actor: userActor(user) });
  });
