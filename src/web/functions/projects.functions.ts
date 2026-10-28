import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { hasPendingRuntimeChanges } from "@/deployments";
import { listProjectDomains } from "@/domains";
import { listProjectContainers, getWorkerStatus } from "@/monitoring";
import {
  approveProject,
  createProject,
  getProject,
  listProjects,
  requestProjectDeletion,
  setRepositoryToken,
  updateProject,
} from "@/projects";
import { getSecretBox } from "@/secrets";
import { getSystemSettings } from "@/settings";
import { projectInputSchema, repositoryTokenSchema } from "@/shared/project.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

const MAX_SEARCH_LENGTH = 100;

export const listProjectsFn = createServerFn({ method: "GET" })
  .validator(z.object({ search: z.string().max(MAX_SEARCH_LENGTH).optional() }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listProjects(getDatabase(), { search: data.search ?? "" });
  });

export const getProjectFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    return {
      project,
      domains: listProjectDomains(database, project.id, getSystemSettings(database)),
      containers: listProjectContainers(database, project.id),
      worker: getWorkerStatus(database),
      /** Variables or domains changed since the live container started. */
      pendingRuntimeChanges: hasPendingRuntimeChanges(database, project.id),
    };
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .validator(projectInputSchema)
  .handler(async ({ data }) => {
    const user = await authorize("project:write");
    return createProject(getDatabase(), data, {
      actor: userActor(user),
      userId: user.id,
      isAdmin: user.role === "admin",
    });
  });

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, project: projectInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("project:write");
    return updateProject(getDatabase(), data.projectId, data.project, {
      actor: userActor(user),
      isAdmin: user.role === "admin",
    });
  });

export const approveProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorize("project:approve");
    approveProject(getDatabase(), data.projectId, userActor(user));
  });

export const deleteProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorize("project:delete");
    requestProjectDeletion(getDatabase(), data.projectId, userActor(user));
  });

export const setRepositoryTokenFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, token: repositoryTokenSchema.nullable() }))
  .handler(async ({ data }) => {
    // Changing credentials changes which code can be fetched, so only admins may do it.
    const user = await authorize("project:approve");
    await setRepositoryToken(
      getDatabase(),
      await getSecretBox(),
      data.projectId,
      data.token,
      userActor(user),
    );
  });
