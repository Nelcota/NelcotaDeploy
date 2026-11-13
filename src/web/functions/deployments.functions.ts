import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import {
  applyPendingChanges,
  cancelDeployment,
  CONTAINER_ACTIONS,
  DEPLOYMENT_STATUSES,
  getDeployment,
  listDeployments,
  listRollbackCandidates,
  redeployProject,
  requestContainerAction,
  requestDeployment,
  retryDeployment,
  summarizeDeployments,
} from "@/deployments";
import { getPreview } from "@/previews";
import { pageCursorSchema } from "@/shared/pagination";
import {
  authorizeDeployment,
  authorizeProject,
  authorizeProjectListing,
} from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

const MAX_PAGE_SIZE = 100;
const MAX_STATS_DAYS = 30;

export const listDeploymentsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      projectId: idSchema.optional(),
      status: z.enum([...DEPLOYMENT_STATUSES, "active"]).optional(),
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
      before: pageCursorSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { projectIds } = await authorizeProjectListing();
    return listDeployments(getDatabase(), { ...data, projectIds });
  });

/** Totals, success rate, average duration and per-day counts of the last `days` days. */
export const getDeploymentStatsFn = createServerFn({ method: "GET" })
  .validator(z.object({ days: z.number().int().min(1).max(MAX_STATS_DAYS) }))
  .handler(async ({ data }) => {
    const { projectIds } = await authorizeProjectListing();
    return summarizeDeployments(getDatabase(), { days: data.days, projectIds });
  });

export const getDeploymentFn = createServerFn({ method: "GET" })
  .validator(z.object({ deploymentId: idSchema }))
  .handler(async ({ data }) => {
    await authorizeDeployment("project:read", data.deploymentId);
    const database = getDatabase();
    const deployment = getDeployment(database, data.deploymentId);
    const preview =
      deployment.status === "failed" && deployment.previewId != null
        ? getPreview(database, deployment.previewId)
        : null;
    return {
      ...deployment,
      previewDeploymentId: preview?.status === "active" ? preview.currentDeploymentId : null,
    };
  });

export const deployProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject("deployment:create", data.projectId);
    return requestDeployment(getDatabase(), {
      projectId: data.projectId,
      trigger: "manual",
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Builds again the commit of a deploy that failed or was cancelled. */
export const retryDeploymentFn = createServerFn({ method: "POST" })
  .validator(z.object({ deploymentId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeDeployment("deployment:create", data.deploymentId);
    return retryDeployment(getDatabase(), data.deploymentId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Recreates the container from the current image, applying new variables and domains. */
export const redeployProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject("deployment:create", data.projectId);
    return redeployProject(getDatabase(), data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Applies saved variables and domains, rebuilding when a build variable changed. */
export const applyProjectChangesFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject("deployment:create", data.projectId);
    return applyPendingChanges(getDatabase(), data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

export const rollbackDeploymentFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, deploymentId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("deployment:create", data.projectId);
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
    const user = await authorizeDeployment("deployment:create", data.deploymentId);
    return cancelDeployment(getDatabase(), data.deploymentId, userActor(user));
  });

export const listRollbackCandidatesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    return listRollbackCandidates(getDatabase(), data.projectId);
  });

export const containerActionFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, action: z.enum(CONTAINER_ACTIONS) }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("container:control", data.projectId);
    return requestContainerAction(getDatabase(), { ...data, actor: userActor(user) });
  });
