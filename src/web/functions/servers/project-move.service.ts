import { count, eq } from "drizzle-orm";

import type { Actor } from "@/audit";
import { assertProjectHasNoDatabases } from "@/databases";
import { type Database, tables } from "@/db";
import {
  getActiveRuntimeDeployment,
  ProjectNotApprovedError,
  requestDeployment,
} from "@/deployments";
import { getProject } from "@/projects";
import {
  assignProjectServer,
  ProjectMoveInProgressError,
  ProjectMoveReviewChangedError,
} from "@/servers";
import { assertProjectHasNoVolumes } from "@/volumes";

type ProjectMoveRequest = {
  readonly projectId: string;
  readonly serverId: string;
  readonly expectedServerId: string;
  readonly expectedDeploymentId: string | null;
  readonly expectedUpdatedAt: string;
};

/**
 * Reads the source revision and local resources that must be reviewed before a server move.
 * @param database - Database.
 * @param projectId - Project being reviewed.
 * @returns Current source identity, local resource counts and active production deployment.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function projectMoveStatus(database: Database, projectId: string) {
  const project = getProject(database, projectId);
  // Both counts use existing indexes whose first column is project_id.
  const volumes = database
    .select({ total: count() })
    .from(tables.projectVolumes)
    .where(eq(tables.projectVolumes.projectId, projectId))
    .get();
  const databases = database
    .select({ total: count() })
    .from(tables.projectDatabases)
    .where(eq(tables.projectDatabases.projectId, projectId))
    .get();
  return {
    serverId: project.serverId,
    currentDeploymentId: project.currentDeploymentId,
    updatedAt: project.updatedAt,
    deploymentsApproved: project.deploymentsApproved,
    volumeCount: volumes?.total ?? 0,
    databaseCount: databases?.total ?? 0,
    activeDeployment: getActiveRuntimeDeployment(database, projectId),
  };
}

/**
 * Applies a reviewed server move and queues its redeploy as one atomic change.
 * @param database - Shared synchronous database connection.
 * @param request - Destination and exact source revision that the user reviewed.
 * @param context - Authorized actor and the user requesting the redeploy.
 * @returns Destination, queued deployment and whether a move was needed.
 * @throws {ProjectNotFoundError} When the project no longer exists.
 * @throws {ProjectMoveReviewChangedError} When the reviewed source revision changed.
 * @throws {ProjectMoveInProgressError} When production already has an active deployment.
 * @throws {ProjectNotApprovedError} When a deployed project is no longer approved.
 * @throws {ProjectHasVolumesError} When the project still has local volumes.
 * @throws {ProjectHasDatabasesError} When the project still has local databases.
 * @throws {ServerNotFoundError} When the destination no longer exists.
 * @throws {ServerNotReadyError} When the destination is not ready.
 * @throws {RollbackUnavailableError} When the live image cannot be reused for the move.
 */
export function moveProject(
  database: Database,
  request: ProjectMoveRequest,
  context: {
    readonly actor: Actor;
    readonly triggeredByUserId: string | null;
  },
) {
  // Services share this connection; Bun turns their nested transactions into savepoints.
  return database.transaction(
    () => {
      const project = getProject(database, request.projectId);
      if (project.serverId === request.serverId) {
        return { serverId: project.serverId, deploymentId: null, changed: false };
      }
      if (
        project.serverId !== request.expectedServerId ||
        project.currentDeploymentId !== request.expectedDeploymentId ||
        project.updatedAt !== request.expectedUpdatedAt
      ) {
        throw new ProjectMoveReviewChangedError(project.id);
      }
      if (getActiveRuntimeDeployment(database, project.id) != null) {
        throw new ProjectMoveInProgressError(project.id);
      }
      if (project.currentDeploymentId != null && project.deploymentsApproved === false) {
        throw new ProjectNotApprovedError(project.id);
      }
      assertProjectHasNoVolumes(database, project.id);
      assertProjectHasNoDatabases(database, project.id);
      assignProjectServer(database, {
        projectId: project.id,
        serverId: request.serverId,
        actor: context.actor,
      });
      if (project.currentDeploymentId == null) {
        return { serverId: request.serverId, deploymentId: null, changed: true };
      }
      const queued = requestDeployment(database, {
        projectId: project.id,
        trigger: "redeploy",
        ...context,
        sourceDeploymentId: project.currentDeploymentId,
      });
      return { serverId: request.serverId, deploymentId: queued.deploymentId, changed: true };
    },
    { behavior: "immediate" },
  );
}
