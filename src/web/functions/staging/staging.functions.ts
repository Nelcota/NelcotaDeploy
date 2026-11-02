import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { getSecretBox } from "@/secrets";
import { stagingInputSchema } from "@/shared/schemas/staging.schema";
import { createStagingEnvironment, promoteStagingToProduction } from "@/staging";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema } from "../ids";

/** Creates the staging environment of a production project. */
export const createStagingFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, staging: stagingInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    const staging = await createStagingEnvironment(getDatabase(), await getSecretBox(), {
      productionProjectId: data.projectId,
      branch: data.staging.branch,
      copyVariables: data.staging.copyVariables,
      creator: { actor: userActor(user), userId: user.id, isAdmin: user.role === "admin" },
    });
    return { stagingProjectId: staging.id };
  });

/** Deploys to production the commit that is live on a staging environment. */
export const promoteStagingFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, expectedDeploymentId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("deployment:create", data.projectId);
    return promoteStagingToProduction(getDatabase(), {
      stagingProjectId: data.projectId,
      expectedDeploymentId: data.expectedDeploymentId,
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });
