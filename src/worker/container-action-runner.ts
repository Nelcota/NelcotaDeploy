import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { type ContainerAction, getDeployment } from "@/deployments";
import { type DockerEngine, LABELS, volumeNameFor } from "@/docker";
import type { Job } from "@/jobs";
import { previewRoutePrefix } from "@/previews";
import { getProject } from "@/projects";
import type { RouteFiles } from "@/routing";
import { failVolumeDeletion, finishVolumeDeletion } from "@/volumes";

import type { WorkerDependencies } from "./worker.types";

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
 * Removes a project's routes, containers, images and volumes from one server. The routes go
 * first, so the proxy never sends requests to a container that is being removed.
 *
 * @param server - Docker and route files of that server.
 * @param projectId - Project whose resources go.
 * @returns How many containers, images and volumes were removed.
 * @throws {RouteFileError} When the routes cannot be removed.
 */
export async function removeProjectResources(
  { docker, routes }: ProjectServer,
  projectId: string,
): Promise<{ containers: number; images: number; volumes: number }> {
  await routes?.remove(projectId);
  await routes?.removePrefixed(previewRoutePrefix(projectId));
  const containers = (await docker.listManagedContainers()).filter(
    (container) => container.labels[LABELS.projectId] === projectId,
  );
  await Promise.all(
    containers.map(async (container) => await docker.removeContainer(container.id)),
  );
  const images = await docker.images.listForProject(projectId, "all");
  const imageRemovals = await Promise.allSettled(
    images.map(async (image) => await docker.images.remove(image)),
  );
  // Volumes go last: no container of the project uses them any more.
  const volumes = await docker.volumes.listForProject(projectId);
  const volumeRemovals = await Promise.allSettled(
    volumes.map(async (volume) => await docker.volumes.remove(volume)),
  );
  return {
    containers: containers.length,
    images: imageRemovals.filter((result) => result.status === "fulfilled").length,
    volumes: volumeRemovals.filter((result) => result.status === "fulfilled").length,
  };
}

/**
 * Deletes the data of a detached volume on its project's server, then the volume itself.
 *
 * @param database - Database.
 * @param volumes - Volumes of the project's server.
 * @param request - Project and volume.
 * @throws {DockerCommandError} When Docker refuses, for example while a container still uses
 *   the volume; the reason is stored on the volume first.
 */
export async function runVolumeDeletion(
  database: Database,
  volumes: DockerEngine["volumes"],
  request: { readonly projectId: string; readonly volumeId: string },
): Promise<void> {
  const name = volumeNameFor(request.volumeId);
  try {
    // A volume that was never mounted has no data on the server yet.
    if ((await volumes.listForProject(request.projectId)).includes(name)) {
      await volumes.remove(name);
    }
  } catch (error) {
    failVolumeDeletion(
      database,
      request.volumeId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  finishVolumeDeletion(database, request.volumeId);
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
 * @returns How many containers, images and volumes were removed, and the errors of unreachable
 *   servers.
 */
export async function runProjectCleanup(
  database: Database,
  servers: readonly ProjectServer[],
  projectId: string,
): Promise<{ containers: number; images: number; volumes: number; failures: unknown[] }> {
  const results = await Promise.allSettled(
    servers.map(async (server) => await removeProjectResources(server, projectId)),
  );
  database.delete(tables.projects).where(eq(tables.projects.id, projectId)).run();
  const removed = { containers: 0, images: 0, volumes: 0, failures: [] as unknown[] };
  for (const result of results) {
    if (result.status === "rejected") {
      removed.failures.push(result.reason);
      continue;
    }
    removed.containers += result.value.containers;
    removed.images += result.value.images;
    removed.volumes += result.value.volumes;
  }
  return removed;
}

/**
 * Runs a `volume_delete` job on the server of the volume's project.
 *
 * @param dependencies - Worker dependencies.
 * @param job - The claimed job; its payload names the volume.
 * @throws {Error} When the payload has no volume id, or the deletion fails.
 */
export async function runVolumeDeleteJob(
  dependencies: Pick<WorkerDependencies, "database" | "hosts">,
  job: Job,
): Promise<void> {
  const volumeId = job.payload["volumeId"];
  if (typeof volumeId !== "string" || volumeId === "") {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its volume id`);
  }
  const { database, hosts } = dependencies;
  // Projects with volumes cannot move, so the data is on the project's current server.
  const host = hosts.hostOf(database, getProject(database, job.projectId).serverId);
  await runVolumeDeletion(database, host.docker.volumes, { projectId: job.projectId, volumeId });
}
