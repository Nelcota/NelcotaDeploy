import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "../ids";
import { moveProject, projectMoveStatus } from "./project-move.service";

/** Read-only prerequisites for the server move shown in project settings. */
export const getProjectMoveStatusFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("settings:write");
    return projectMoveStatus(getDatabase(), data.projectId);
  });

/**
 * Confirms a reviewed server move, with its redeploy queued in the same transaction.
 */
export const moveProjectFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: idSchema,
      serverId: idSchema,
      expectedServerId: idSchema,
      expectedDeploymentId: idSchema.nullable(),
      expectedUpdatedAt: z.iso.datetime(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    return moveProject(getDatabase(), data, { actor: userActor(user), triggeredByUserId: user.id });
  });
