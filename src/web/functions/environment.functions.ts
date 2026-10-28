import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import {
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  saveEnvironmentVariable,
} from "@/environments";
import { getSecretBox } from "@/secrets";
import { environmentVariableInputSchema } from "@/shared/environment-variable.schema";
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
    await saveEnvironmentVariable(
      getDatabase(),
      await getSecretBox(),
      data.projectId,
      data.variable,
      userActor(user),
    );
  });

export const deleteEnvironmentVariableFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, variableId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("environment:write");
    deleteEnvironmentVariable(getDatabase(), data.projectId, data.variableId, userActor(user));
  });
