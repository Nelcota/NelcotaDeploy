import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { type ContainerAction, getDeployment } from "@/deployments";
import { type DockerEngine, LABELS } from "@/docker";
import type { RouteFiles } from "@/routing";

/** What cleaning a project off one server needs: its Docker and its proxy's route files. */
type ProjectServer = { readonly docker: DockerEngine; readonly routes: RouteFiles | null };

/**
 * Starts, stops or restarts the container of a deployment.
 *
 * @param database - Database.
 * @param docker - Docker access; refuses containers without the platform label.
 * @param request - Deployment whose container is targeted and the operation to perform.
 * @throws {Error} When the deployment has no container name.
 */
export async function runContainerAction(
  database: Database,
  docker: DockerEngine,
  { deploymentId, action }: { readonly deploymentId: string; readonly action: ContainerAction },
): Promise<void> {
  const deployment = getDeployment(database, deploymentId);
  if (deployment.containerName == null) {
    throw new Error(`Deployment ${deploymentId} has no container`);
  }
  switch (action) {
    case "start":
      await docker.startContainer(deployment.containerName);
      return;
    case "stop":
      await docker.stopContainer(deployment.containerName);
      return;
    case "restart":
      await docker.restartContainer(deployment.containerName);
  }
}

/**
 * Removes a project's routes, containers and images from one server. The routes go first, so
 * the proxy never sends requests to a container that is being removed.
 *
 * @param server - Docker and route files of that server.
 * @param projectId - Project whose resources go.
 * @returns How many containers and images were removed.
 * @throws {RouteFileError} When the routes cannot be removed.
 */
export async function removeProjectResources(
  { docker, routes }: ProjectServer,
  projectId: string,
): Promise<{ containers: number; images: number }> {
  await routes?.remove(projectId);
  const containers = (await docker.listManagedContainers()).filter(
    (container) => container.labels[LABELS.projectId] === projectId,
  );
  await Promise.all(
    containers.map(async (container) => await docker.removeContainer(container.id)),
  );
  const images = await docker.listProjectImages(projectId);
  const removals = await Promise.allSettled(
    images.map(async (image) => await docker.removeImage(image)),
  );
  return {
    containers: containers.length,
    images: removals.filter((result) => result.status === "fulfilled").length,
  };
}

/**
 * Removes every container and image of a project from every server it ever ran on, then the
 * project row and its history.
 *
 * @remarks
 * A server that cannot be reached does not block the deletion: the project row goes anyway,
 * and the worker removes containers of deleted projects when that server is back.
 *
 * @param database - Database.
 * @param servers - Docker and route files of each server the project ran on.
 * @param projectId - Project being deleted.
 * @returns How many containers and images were removed, and the errors of unreachable servers.
 */
export async function runProjectCleanup(
  database: Database,
  servers: readonly ProjectServer[],
  projectId: string,
): Promise<{ containers: number; images: number; failures: unknown[] }> {
  const results = await Promise.allSettled(
    servers.map(async (server) => await removeProjectResources(server, projectId)),
  );
  database.delete(tables.projects).where(eq(tables.projects.id, projectId)).run();
  const removed = { containers: 0, images: 0, failures: [] as unknown[] };
  for (const result of results) {
    if (result.status === "rejected") {
      removed.failures.push(result.reason);
      continue;
    }
    removed.containers += result.value.containers;
    removed.images += result.value.images;
  }
  return removed;
}
