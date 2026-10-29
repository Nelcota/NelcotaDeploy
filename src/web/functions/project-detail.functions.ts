import { createServerFn } from "@tanstack/react-start";

import { getDatabase } from "@/db";
import { hasPendingRuntimeChanges } from "@/deployments";
import { listProjectDomains } from "@/domains";
import { getWorkerStatus, listProjectContainers } from "@/monitoring";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";
import { authorize } from "@/web/server/authorization";

import { projectIdInput } from "./ids";

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
