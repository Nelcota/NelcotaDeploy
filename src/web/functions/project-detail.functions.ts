import { createServerFn } from "@tanstack/react-start";

import { getDatabase } from "@/db";
import { getDeployment, hasPendingRuntimeChanges } from "@/deployments";
import { listProjectDomains } from "@/domains";
import { getWorkerStatus, listProjectContainers } from "@/monitoring";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";
import { findStagingProject } from "@/staging";
import { authorize } from "@/web/server/authorization";

import { projectIdInput } from "./ids";

export const getProjectFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    const project = getProject(database, data.projectId);
    // A staging project points at its production one; production finds its staging.
    const staging =
      project.parentProjectId == null ? findStagingProject(database, project.id) : project;
    return {
      project,
      domains: listProjectDomains(database, project.id, getSystemSettings(database)),
      containers: listProjectContainers(database, project.id),
      worker: getWorkerStatus(database),
      /** Variables or domains changed since the live container started. */
      pendingRuntimeChanges: hasPendingRuntimeChanges(database, project.id),
      /** Production project and its staging environment, for the environment switcher. */
      /** Commit of the live deployment, which a staging project can promote. */
      liveCommitSha:
        project.currentDeploymentId == null
          ? null
          : getDeployment(database, project.currentDeploymentId).commitSha,
      environments: {
        productionId: project.parentProjectId ?? project.id,
        stagingId: staging?.id ?? null,
      },
    };
  });
