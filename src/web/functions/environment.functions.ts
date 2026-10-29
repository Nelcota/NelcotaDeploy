import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import {
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  saveEnvironmentVariable,
} from "@/environments";
import { getSecretBox } from "@/secrets";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

export const listEnvironmentVariablesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listEnvironmentVariables(getDatabase(), data.projectId);
  });

export const saveEnvironmentVariableFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, variable: environmentVariableInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("environment:write");
    const database = getDatabase();
    await saveEnvironmentVariable(database, await getSecretBox(), {
      projectId: data.projectId,
      input: data.variable,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

export const deleteEnvironmentVariableFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, variableId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("environment:write");
    const database = getDatabase();
    deleteEnvironmentVariable(database, {
      projectId: data.projectId,
      variableId: data.variableId,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });
