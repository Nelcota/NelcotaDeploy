import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import { readRepositoryEnvironmentExample } from "@/github";
import { getProject, readRepositoryToken } from "@/projects";
import { getSecretBox } from "@/secrets";
import { isSafeRelativePath } from "@/shared/schemas/project.schema";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema } from "../ids";

export const getEnvironmentExampleFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      projectId: idSchema,
      path: z.string().refine(isSafeRelativePath, "Caminho inválido").optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await authorizeProject("environment:write", data.projectId);
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    const secretBox = await getSecretBox();
    const token = await readRepositoryToken(database, secretBox, project.id);
    return await readRepositoryEnvironmentExample(
      { database, secretBox },
      {
        repositoryUrl: project.repositoryUrl,
        branch: project.branch,
        buildContext: project.buildContext,
        dockerfilePath: project.dockerfilePath,
        path: data.path,
        token,
        allowGitHubApp: user.role === "admin" || project.deploymentsApproved,
      },
    );
  });
