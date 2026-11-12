import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
  getRepositoryAccess,
  GitHubApiError,
  inspectRepository,
  readRepositoryHealthCheck,
} from "@/github";
import { getProject, readRepositoryToken, suggestProjectSlug } from "@/projects";
import { getSecretBox } from "@/secrets";
import {
  parseGitHubRepository,
  projectInputSchema,
  slugify,
} from "@/shared/schemas/project.schema";
import { authorize, authorizeProject } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";

import { idSchema, projectIdInput } from "../ids";

const inspectionSchema = z.object({
  repositoryUrl: projectInputSchema.shape.repositoryUrl,
  branch: projectInputSchema.shape.branch.optional(),
  projectId: idSchema.optional(),
});
const HTTP_NOT_FOUND = 404;

async function inspectionContext(
  data: {
    readonly repositoryUrl: string;
    readonly projectId?: string | undefined;
  },
  isAdmin: boolean,
) {
  const database = getDatabase();
  const box = await getSecretBox();
  const project = data.projectId == null ? null : getProject(database, data.projectId);
  const sameRepository =
    project?.repositoryFullName === parseGitHubRepository(data.repositoryUrl)?.fullName;
  const allowGitHubApp =
    isAdmin || (project != null && sameRepository && project.deploymentsApproved);
  const token =
    project != null && sameRepository ? await readRepositoryToken(database, box, project.id) : null;
  return { database, box, token, allowGitHubApp };
}

export const getRepositoryHealthCheckFn = createServerFn({ method: "GET" })
  .validator(
    inspectionSchema.required({ branch: true }).extend({
      dockerfilePath: projectInputSchema.shape.dockerfilePath,
      buildContext: projectInputSchema.shape.buildContext,
    }),
  )
  .handler(async ({ data }) => {
    const user =
      data.projectId == null
        ? await authorize("project:write")
        : await authorizeProject("project:write", data.projectId);
    const { database, box, token, allowGitHubApp } = await inspectionContext(
      data,
      user.role === "admin",
    );
    return await readRepositoryHealthCheck(
      { database, secretBox: box },
      { ...data, token, allowGitHubApp },
    );
  });

export const inspectRepositoryFn = createServerFn({ method: "GET" })
  .validator(inspectionSchema)
  .handler(async ({ data }) => {
    const user =
      data.projectId == null
        ? await authorize("project:write")
        : await authorizeProject("project:write", data.projectId);
    const { database, box, token, allowGitHubApp } = await inspectionContext(
      data,
      user.role === "admin",
    );
    try {
      return await inspectRepository(
        { database, secretBox: box },
        { ...data, token, allowGitHubApp },
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === HTTP_NOT_FOUND) {
        throw new PublicError(
          "Repositório ou branch não encontrado. Confira o endereço e o acesso do GitHub App.",
        );
      }
      throw error;
    }
  });

export const getRepositoryAccessFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:approve", data.projectId);
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    const box = await getSecretBox();
    const token = await readRepositoryToken(database, box, project.id);
    return await getRepositoryAccess(
      { database, secretBox: box },
      {
        repositoryUrl: project.repositoryUrl,
        token,
      },
    );
  });

export const suggestProjectSlugFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      name: projectInputSchema.shape.name.refine(
        (name) => slugify(name) !== "",
        "Use letras ou números no nome",
      ),
    }),
  )
  .handler(async ({ data }) => {
    await authorize("project:write");
    return { name: data.name, slug: suggestProjectSlug(getDatabase(), data.name) };
  });
