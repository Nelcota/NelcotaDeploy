import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { addProjectCreator } from "@/access";
import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { getGitHubApp, listConnectedRepositories } from "@/github";
import {
  approveProject,
  createProject,
  listProjects,
  requestProjectDeletion,
  setRepositoryToken,
  updateProjectSettings,
} from "@/projects";
import { getSecretBox } from "@/secrets";
import { projectInputSchema, repositoryTokenSchema } from "@/shared/schemas/project.schema";
import { projectSettingsChangeSchema } from "@/shared/schemas/settings/project-settings.schema";
import { authorize, authorizeProject, authorizeProjectListing } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

const MAX_SEARCH_LENGTH = 100;

export const listProjectsFn = createServerFn({ method: "GET" })
  .validator(z.object({ search: z.string().max(MAX_SEARCH_LENGTH).optional() }))
  .handler(async ({ data }) => {
    const { projectIds } = await authorizeProjectListing();
    return listProjects(getDatabase(), { search: data.search ?? "", projectIds });
  });

/** Repositories the GitHub App can read, for the new-project picker; null without an app. */
export const listGitHubRepositoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:write");
  const database = getDatabase();
  // Checked first so a panel without an app never needs the encryption key here.
  if (getGitHubApp(database) == null) {
    return null;
  }
  return await listConnectedRepositories(database, await getSecretBox());
});

export const createProjectFn = createServerFn({ method: "POST" })
  .validator(projectInputSchema)
  .handler(async ({ data }) => {
    const user = await authorize("project:write");
    const database = getDatabase();
    const actor = userActor(user);
    const project = createProject(database, data, {
      actor,
      userId: user.id,
      isAdmin: user.role === "admin",
    });
    addProjectCreator(database, { projectId: project.id, creator: user, actor });
    return project;
  });

export const updateProjectSettingsFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, change: projectSettingsChangeSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    return updateProjectSettings(getDatabase(), {
      ...data,
      editor: { actor: userActor(user), isAdmin: user.role === "admin" },
    });
  });

export const approveProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:approve", data.projectId);
    approveProject(getDatabase(), data.projectId, userActor(user));
  });

export const deleteProjectFn = createServerFn({ method: "POST" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:delete", data.projectId);
    requestProjectDeletion(getDatabase(), data.projectId, userActor(user));
  });

export const setRepositoryTokenFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, token: repositoryTokenSchema.nullable() }))
  .handler(async ({ data }) => {
    // Changing credentials changes which code can be fetched, so only admins may do it.
    const user = await authorizeProject("project:approve", data.projectId);
    await setRepositoryToken(getDatabase(), await getSecretBox(), {
      projectId: data.projectId,
      token: data.token,
      actor: userActor(user),
    });
  });
