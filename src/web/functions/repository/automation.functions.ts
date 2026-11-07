import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import { readRepositoryTaskScripts, readRepositoryVolumeHints } from "@/github";
import { getProject, readRepositoryToken } from "@/projects";
import { getSecretBox } from "@/secrets";
import { isSafeRelativePath } from "@/shared/schemas/project.schema";
import { authorizeProject } from "@/web/server/authorization";

import { projectIdInput } from "../ids";

async function repositoryContext(projectId: string) {
  const database = getDatabase();
  const project = getProject(database, projectId);
  const secretBox = await getSecretBox();
  const token = await readRepositoryToken(database, secretBox, projectId);
  return {
    dependencies: { database, secretBox },
    request: {
      repositoryUrl: project.repositoryUrl,
      branch: project.branch,
      buildContext: project.buildContext,
      dockerfilePath: project.dockerfilePath,
      token,
    },
  };
}

export const getRepositoryTasksFn = createServerFn({ method: "GET" })
  .validator(
    projectIdInput.extend({
      packagePath: z.string().refine(isSafeRelativePath, "Caminho inválido").optional(),
    }),
  )
  .handler(async ({ data }) => {
    await authorizeProject("task:write", data.projectId);
    const context = await repositoryContext(data.projectId);
    return await readRepositoryTaskScripts(context.dependencies, {
      ...context.request,
      packagePath: data.packagePath,
    });
  });

export const getRepositoryVolumesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:write", data.projectId);
    const context = await repositoryContext(data.projectId);
    return await readRepositoryVolumeHints(context.dependencies, context.request);
  });
