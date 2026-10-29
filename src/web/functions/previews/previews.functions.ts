import { createServerFn } from "@tanstack/react-start";

import { getDatabase } from "@/db";
import { MAX_ACTIVE_PREVIEWS, summarizePreviews } from "@/previews";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";
import { authorize } from "@/web/server/authorization";

import { projectIdInput } from "../ids";

/** Active pull request previews of a project, with their address, newest deployment and limit. */
export const listPreviewsFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    return {
      previews: summarizePreviews(database, project, getSystemSettings(database)),
      limit: MAX_ACTIVE_PREVIEWS,
    };
  });
