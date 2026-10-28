import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { type ContainerAction, getDeployment } from "@/deployments";
import { type DockerEngine, LABELS } from "@/docker";

/**
 * Starts, stops or restarts the container of a deployment.
 *
 * @param database - Database.
 * @param docker - Docker access; refuses containers without the platform label.
 * @param deploymentId - Deployment whose container is targeted.
 * @param action - Operation to perform.
 * @throws {Error} When the deployment has no container name.
 */
export async function runContainerAction(
  database: Database,
  docker: DockerEngine,
  deploymentId: string,
  action: ContainerAction,
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
 * Removes every container and image of a project, then the project row and its history.
 *
 * @param database - Database.
 * @param docker - Docker access.
 * @param projectId - Project being deleted.
 * @returns How many containers and images were removed.
 */
export async function runProjectCleanup(
  database: Database,
  docker: DockerEngine,
  projectId: string,
): Promise<{ containers: number; images: number }> {
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
  database.delete(tables.projects).where(eq(tables.projects.id, projectId)).run();
  return {
    containers: containers.length,
    images: removals.filter((result) => result.status === "fulfilled").length,
  };
}
