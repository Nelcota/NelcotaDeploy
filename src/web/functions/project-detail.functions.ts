import { createServerFn } from "@tanstack/react-start";

import { assertProjectPermission } from "@/access";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import {
  firstPublishedDeploymentId,
  getActiveRuntimeDeployment,
  getDeployment,
  hasPendingRuntimeChanges,
} from "@/deployments";
import { listProjectDomains } from "@/domains";
import { getWorkerStatus, listProjectContainers } from "@/monitoring";
import { getProject } from "@/projects";
import { LOCAL_SERVER_ID } from "@/servers";
import { getSystemSettings } from "@/settings";
import { findStagingProject } from "@/staging";
import { authorize } from "@/web/server/authorization";
import { uiPermissionsOf } from "@/web/server/ui-permissions";

import { projectIdInput } from "./ids";

export const getProjectFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorize("project:read");
    const database = getDatabase();
    const role = assertProjectPermission(database, user, {
      projectId: data.projectId,
      permission: "project:read",
    });
    const project = getProject(database, data.projectId);
    // A staging project points at its production one; production finds its staging.
    const staging =
      project.parentProjectId == null ? findStagingProject(database, project.id) : project;
    const liveDeployment =
      project.currentDeploymentId == null
        ? null
        : getDeployment(database, project.currentDeploymentId);
    return {
      project,
      /** What the interface lets the user do on this project, from their role on it. */
      permissions: uiPermissionsOf(role),
      domains: listProjectDomains(
        database,
        project.id,
        getSystemSettings(database, { includeSecrets: false }),
      ),
      containers: listProjectContainers(database, project.id),
      worker: getWorkerStatus(database),
      /** Variables or domains changed since the live container started. */
      pendingRuntimeChanges: hasPendingRuntimeChanges(database, project.id),
      activeDeployment: getActiveRuntimeDeployment(database, project.id),
      liveDeployment:
        liveDeployment == null
          ? null
          : {
              id: liveDeployment.id,
              commitSha: liveDeployment.commitSha,
              commitMessage: liveDeployment.commitMessage,
              finishedAt: liveDeployment.finishedAt,
              proxyLogsAvailable:
                liveDeployment.serverId !== LOCAL_SERVER_ID || getConfig().TRAEFIK_ENABLED,
              isFirstPublication:
                liveDeployment.id === firstPublishedDeploymentId(database, project.id),
            },
      /** Production project and its staging environment, for the environment switcher. */
      environments: {
        productionId: project.parentProjectId ?? project.id,
        stagingId: staging?.id ?? null,
      },
    };
  });
