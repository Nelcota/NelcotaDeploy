import { listDeploymentServerIds } from "@/deployments";
import { LABELS } from "@/docker";
import type { Job } from "@/jobs";
import { getPreview, previewRouteName } from "@/previews";

import type { ServerHost } from "../server-host";
import type { WorkerDependencies } from "../worker.types";

type PreviewTarget = {
  readonly projectId: string;
  readonly previewId: string;
  readonly pullRequestNumber: number;
};

/**
 * Removes a preview's routes, containers and images from one server. The routes go first, so
 * the proxy never sends requests to a container that is being removed.
 *
 * @param host - Docker and route files of that server.
 * @param preview - Project, preview and its pull request number.
 * @returns How many containers and images were removed.
 */
async function removePreviewResources(
  { docker, routes }: Pick<ServerHost, "docker" | "routes">,
  preview: PreviewTarget,
): Promise<{ containers: number; images: number }> {
  await routes?.remove(previewRouteName(preview.projectId, preview.pullRequestNumber));
  const containers = (await docker.listManagedContainers()).filter(
    (container) => container.labels[LABELS.previewId] === preview.previewId,
  );
  await Promise.all(
    containers.map(async (container) => await docker.removeContainer(container.id)),
  );
  const images = await docker.images.listForProject(preview.projectId, {
    previewId: preview.previewId,
  });
  const removals = await Promise.allSettled(
    images.map(async (image) => await docker.images.remove(image)),
  );
  return {
    containers: containers.length,
    images: removals.filter((result) => result.status === "fulfilled").length,
  };
}

/**
 * Runs a `preview_cleanup` job: removes a closed preview from every server the project used.
 *
 * @param dependencies - Database, server hosts and logger.
 * @param job - The claimed job; its payload names the preview.
 * @throws {Error} When the payload has no preview id or a server cannot be cleaned.
 */
export async function runPreviewCleanupJob(
  dependencies: Pick<WorkerDependencies, "database" | "logger"> & {
    readonly hosts: {
      readonly hostsOf: (
        ...args: Parameters<WorkerDependencies["hosts"]["hostsOf"]>
      ) => readonly Pick<ServerHost, "docker" | "routes">[];
    };
  },
  job: Job,
): Promise<void> {
  const previewId = job.payload["previewId"];
  if (typeof previewId !== "string" || previewId === "") {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its preview id`);
  }
  const { database, hosts, logger } = dependencies;
  const preview = getPreview(database, previewId);
  if (preview == null) {
    // The project and its previews were deleted; the project cleanup removed everything.
    return;
  }
  const target = {
    projectId: preview.projectId,
    previewId,
    pullRequestNumber: preview.pullRequestNumber,
  };
  const servers = hosts.hostsOf(database, listDeploymentServerIds(database, preview.projectId));
  const results = await Promise.all(
    servers.map(async (host) => await removePreviewResources(host, target)),
  );
  logger.info(
    { previewId, pullRequestNumber: preview.pullRequestNumber, results },
    "closed preview removed",
  );
}
