import { type ContainerInfo, type DockerEngine, LABELS } from "@/docker";

import { type DeployRunnerDependencies, errorMessageOf } from "./deploy-context";
import type { DeploymentLogWriter } from "./deployment-log-writer";

const FAILED_CONTAINER_LOG_LINES = 50;
/** Time an old container gets to finish in-flight requests after SIGTERM. */
const STOP_GRACE_IN_SECONDS = 30;
/** A preview has no rollback: only its running image is kept. */
const PREVIEW_IMAGES_KEPT = 1;

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
    // The routes no longer point here; a graceful stop lets requests still running finish.
    await docker.stopContainer(container.id, STOP_GRACE_IN_SECONDS);
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
 * Retires the project's containers from earlier deployments, one at a time, once the routes
 * point at the new one: stops each old container gracefully, then removes it.
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
    previewId,
  }: {
    readonly projectId: string;
    readonly currentDeploymentId: string;
    /** Preview of the new deployment; null for production. Other scopes are left alone. */
    readonly previewId: string | null;
  },
): Promise<void> {
  const containers = await dependencies.docker.listManagedContainers();
  const previous = containers.filter(
    (container) =>
      container.labels[LABELS.projectId] === projectId &&
      (container.labels[LABELS.previewId] ?? null) === previewId &&
      container.labels[LABELS.deploymentId] !== currentDeploymentId,
  );
  await removeContainersInOrder(dependencies.docker, previous, logs);
}

/**
 * Removes the images beyond the newest ones kept for rollback, within one scope: production's
 * images, or one preview's, which keeps only its running image.
 *
 * @param dependencies - Docker access and the number of images to keep.
 * @param scope - Owning project and preview (null for production).
 * @param logs - Deployment log.
 */
export async function pruneOldImages(
  dependencies: DeployRunnerDependencies,
  scope: { readonly projectId: string; readonly previewId: string | null },
  logs: DeploymentLogWriter,
): Promise<void> {
  try {
    const images = await dependencies.docker.images.listForProject(scope.projectId, {
      previewId: scope.previewId,
    });
    const kept =
      scope.previewId == null ? dependencies.config.imagesKeptPerProject : PREVIEW_IMAGES_KEPT;
    const stale = images.slice(kept);
    const results = await Promise.allSettled(
      stale.map(async (image) => await dependencies.docker.images.remove(image)),
    );
    const removed = results.filter((result) => result.status === "fulfilled").length;
    if (removed > 0) {
      logs.system(`Removed ${removed} old image(s); kept the ${kept} newest`);
    }
  } catch (error) {
    logs.system(`Could not prune old images: ${errorMessageOf(error)}`, "warn");
  }
}
