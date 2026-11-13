import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { addProjectCreator } from "@/access";
import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { getGitHubApp, listConnectedRepositories } from "@/github";
import {
  approveProject,
  createProject,
  ComposeNeedsNoVolumesError,
  listProjects,
  requestProjectDeletion,
  ProjectSlugTakenError,
  ReplicasNeedNoVolumesError,
  setRepositoryToken,
  updateProjectSettings,
} from "@/projects";
import { getSecretBox } from "@/secrets";
import { projectInputSchema, repositoryTokenSchema } from "@/shared/schemas/project.schema";
import { projectSettingsChangeSchema } from "@/shared/schemas/settings/project-settings.schema";
import { listHttpsStatus } from "@/uptime";
import { authorize, authorizeProject, authorizeProjectListing } from "@/web/server/authorization";
import { toPublicError } from "@/web/server/public-error";

import { idSchema, projectIdInput } from "./ids";

const MAX_SEARCH_LENGTH = 100;

export const listProjectsFn = createServerFn({ method: "GET" })
  .validator(z.object({ search: z.string().max(MAX_SEARCH_LENGTH).optional() }))
  .handler(async ({ data }) => {
    const { projectIds } = await authorizeProjectListing();
    const database = getDatabase();
    const projects = listProjects(database, { search: data.search ?? "", projectIds });
    const https = listHttpsStatus(
      database,
      new Date(),
      projects.map((project) => project.id),
    );
    const issues = Map.groupBy(https.issues, (domain) => domain.projectId);
    const recoveries = Map.groupBy(https.recoveries, (domain) => domain.projectId);
    return projects.map((project) =>
      Object.assign(project, {
        httpsIssueDomains: (issues.get(project.id) ?? []).map((domain) => domain.hostname),
        httpsRecoveries: recoveries.get(project.id) ?? [],
      }),
    );
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
    let project;
    try {
      project = createProject(database, data, {
        actor,
        userId: user.id,
        isAdmin: user.role === "admin",
      });
    } catch (error) {
      return { failure: projectFieldFailure(error) };
    }

    addProjectCreator(database, { projectId: project.id, creator: user, actor });
    return { project };
  });

export const updateProjectSettingsFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, change: projectSettingsChangeSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("project:write", data.projectId);
    try {
      const project = updateProjectSettings(getDatabase(), {
        ...data,
        editor: { actor: userActor(user), isAdmin: user.role === "admin" },
      });
      return { project };
    } catch (error) {
      return { failure: projectFieldFailure(error) };
    }
  });

function projectFieldFailure(error: unknown) {
  const fieldErrors = [
    [ProjectSlugTakenError, "slug"],
    [ReplicasNeedNoVolumesError, "replicas"],
    [ComposeNeedsNoVolumesError, "builder"],
  ] as const;
  const match = fieldErrors.find(([ErrorClass]) => error instanceof ErrorClass);
  const message = match == null ? undefined : toPublicError(error)?.message;
  if (match == null || message == null) {
    throw error;
  }

  return { field: match[1], message };
}

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
