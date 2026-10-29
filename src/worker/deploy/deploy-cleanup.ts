import { type ContainerInfo, type DockerEngine, LABELS } from "@/docker";

import { type DeployRunnerDependencies, errorMessageOf } from "./deploy-context";
import type { DeploymentLogWriter } from "./deployment-log-writer";

const FAILED_CONTAINER_LOG_LINES = 50;

/**
 * Copies the last lines of a failed container into the deployment log, then removes it.
 *
 * @param docker - Docker access.
 * @param containerName - Container started by this deployment, or null when none was.
 * @param logs - Deployment log.
 */
export async function discardFailedContainer(
  docker: DockerEngine,
  containerName: string | null,
  logs: DeploymentLogWriter,
): Promise<void> {
  if (containerName == null) {
    return;
  }
  try {
    const lines = await docker.readContainerLogs(containerName, FAILED_CONTAINER_LOG_LINES);
    if (lines.length > 0) {
      logs.system(`Last ${lines.length} lines from the failed container:`, "warn");
    }
    for (const { line, stream } of lines) {
      logs.output(line, stream);
    }
    await docker.removeContainer(containerName);
    logs.system(
      `Removed failed container ${containerName}; the previous version keeps running`,
      "warn",
    );
  } catch (error) {
    logs.system(`Could not clean up container ${containerName}: ${errorMessageOf(error)}`, "warn");
  }
}

async function removeContainer(
  docker: DockerEngine,
  container: ContainerInfo,
  logs: DeploymentLogWriter,
): Promise<void> {
  try {
    await docker.removeContainer(container.id);
    logs.system(`Removed previous container ${container.name}`);
  } catch (error) {
    logs.system(
      `Could not remove previous container ${container.name}: ${errorMessageOf(error)}`,
      "warn",
    );
  }
}

// Sequential on purpose: stopping containers in parallel spikes host load.
async function removeContainersInOrder(
  docker: DockerEngine,
  containers: readonly ContainerInfo[],
  logs: DeploymentLogWriter,
): Promise<void> {
  const [first, ...rest] = containers;
  if (first == null) {
    return;
  }
  await removeContainer(docker, first, logs);
  await removeContainersInOrder(docker, rest, logs);
}

/**
 * Removes the project's containers from earlier deployments, one at a time.
 *
 * @param dependencies - Docker access.
 * @param logs - Deployment log.
 * @param current - The `projectId` and the `currentDeploymentId` whose container stays.
 */
export async function removePreviousContainers(
  dependencies: DeployRunnerDependencies,
  logs: DeploymentLogWriter,
  {
    projectId,
    currentDeploymentId,
  }: { readonly projectId: string; readonly currentDeploymentId: string },
): Promise<void> {
  const containers = await dependencies.docker.listManagedContainers();
  const previous = containers.filter(
    (container) =>
      container.labels[LABELS.projectId] === projectId &&
      container.labels[LABELS.deploymentId] !== currentDeploymentId,
  );
  await removeContainersInOrder(dependencies.docker, previous, logs);
}

/**
 * Removes the project's images beyond the newest ones kept for rollback.
 *
 * @param dependencies - Docker access and the number of images to keep.
 * @param projectId - Owning project.
 * @param logs - Deployment log.
 */
export async function pruneOldImages(
  dependencies: DeployRunnerDependencies,
  projectId: string,
  logs: DeploymentLogWriter,
): Promise<void> {
  try {
    const images = await dependencies.docker.listProjectImages(projectId);
    const stale = images.slice(dependencies.config.imagesKeptPerProject);
    const results = await Promise.allSettled(
      stale.map(async (image) => await dependencies.docker.removeImage(image)),
    );
    const removed = results.filter((result) => result.status === "fulfilled").length;
    if (removed > 0) {
      logs.system(
        `Removed ${removed} old image(s); kept the ${dependencies.config.imagesKeptPerProject} newest for rollback`,
      );
    }
  } catch (error) {
    logs.system(`Could not prune old images: ${errorMessageOf(error)}`, "warn");
  }
}
