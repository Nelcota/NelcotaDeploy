import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import {
  deleteEnvironmentVariable,
  importEnvironmentVariables,
  listEnvironmentVariables,
  saveEnvironmentVariable,
} from "@/environments";
import { getSecretBox } from "@/secrets";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";
import { environmentImportSchema } from "@/shared/schemas/environment/environment-import.schema";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

/** Imports reviewed variables in one commit and applies the complete configuration once. */
export const importEnvironmentVariablesFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, input: environmentImportSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("environment:write", data.projectId);
    const database = getDatabase();
    const savedCount = await importEnvironmentVariables(database, await getSecretBox(), {
      projectId: data.projectId,
      input: data.input,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
    return { savedCount };
  });

export const listEnvironmentVariablesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    return listEnvironmentVariables(getDatabase(), data.projectId);
  });

export const saveEnvironmentVariableFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, variable: environmentVariableInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("environment:write", data.projectId);
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
    const user = await authorizeProject("environment:write", data.projectId);
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
