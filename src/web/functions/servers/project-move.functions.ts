import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { ProjectNotApprovedError, requestDeployment } from "@/deployments";
import { getProject } from "@/projects";
import { assignProjectServer } from "@/servers";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "../ids";

/**
 * Moves a project to another server. A deployed project is redeployed there at once from the
 * same commit; the worker removes it from the old server after the new one is healthy.
 */
export const moveProjectFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, serverId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    if (project.serverId === data.serverId) {
      return { deploymentId: null };
    }
    // Checked first, so a move that cannot be deployed never changes where the project goes.
    if (project.currentDeploymentId != null && project.deploymentsApproved === false) {
      throw new ProjectNotApprovedError(project.id);
    }
    const actor = userActor(user);
    assignProjectServer(database, { projectId: project.id, serverId: data.serverId, actor });
    if (project.currentDeploymentId == null) {
      return { deploymentId: null };
    }
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      trigger: "redeploy",
      actor,
      triggeredByUserId: user.id,
      sourceDeploymentId: project.currentDeploymentId,
    });
    return { deploymentId };
  });
