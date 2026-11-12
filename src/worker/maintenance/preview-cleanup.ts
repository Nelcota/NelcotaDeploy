import { listDeploymentServerIds } from "@/deployments";
import { LABELS } from "@/docker";
import type { Job } from "@/jobs";
import { getPreview, previewRouteName } from "@/previews";

import type { ServerHost } from "../server-host";
import type { WorkerDependencies } from "../worker.types";

const CLEANUP_BATCH_SIZE = 4;

type PreviewTarget = {
  readonly projectId: string;
  readonly previewId: string;
  readonly pullRequestNumber: number;
};

async function settleCleanup<Item>(
  items: readonly Item[],
  remove: (item: Item) => Promise<void>,
  assertActive: () => void,
): Promise<void> {
  let failure: PromiseRejectedResult | undefined;
  for (let offset = 0; offset < items.length; offset += CLEANUP_BATCH_SIZE) {
    const batch = items.slice(offset, offset + CLEANUP_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        assertActive();
        await remove(item);
      }),
    );
    // A sibling may still be changing remote state after another operation fails.
    assertActive();
    failure ??= results.find((result) => result.status === "rejected");
  }

  if (failure != null) {
    throw failure.reason;
  }
}

/**
 * Removes a preview's routes, containers and images from one server. The routes go first, so
 * the proxy never sends requests to a container that is being removed.
 *
 * @param host - Docker and route files of that server.
 * @param preview - Project, preview and its pull request number.
 * @param assertActive - Checks cancellation and lease ownership before remote operations.
 * @returns How many containers and images were removed.
 */
async function removePreviewResources(
  { docker, routes }: Pick<ServerHost, "docker" | "routes">,
  preview: PreviewTarget,
  assertActive: () => void,
): Promise<{ containers: number; images: number }> {
  assertActive();
  await routes?.remove(previewRouteName(preview.projectId, preview.pullRequestNumber));
  assertActive();
  const containers = (await docker.listManagedContainers()).filter(
    (container) => container.labels[LABELS.previewId] === preview.previewId,
  );
  assertActive();
  await settleCleanup(
    containers,
    async (container) => await docker.removeContainer(container.id),
    assertActive,
  );
  assertActive();
  const images = await docker.images.listForProject(preview.projectId, {
    previewId: preview.previewId,
  });
  assertActive();
  await settleCleanup(images, async (image) => await docker.images.remove(image), assertActive);
  return {
    containers: containers.length,
    images: images.length,
  };
}

/**
 * Runs a `preview_cleanup` job: removes a closed preview from every server the project used.
 *
 * @param dependencies - Database, server hosts and logger.
 * @param job - The claimed job; its payload names the preview.
 * @param assertActive - Checks cancellation and lease ownership before remote operations.
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
  assertActive: () => void,
): Promise<void> {
  const previewId = job.payload["previewId"];
  if (typeof previewId !== "string" || previewId === "") {
    throw new Error(`Job ${job.id} of kind ${job.kind} is missing its preview id`);
  }
  const { database, hosts, logger } = dependencies;
  assertActive();
  const preview = getPreview(database, previewId);
  if (preview?.status !== "closed") {
    // A reopened preview keeps serving until its replacement deployment is ready.
    return;
  }

  if (preview.projectId !== job.projectId) {
    throw new Error(`Job ${job.id} does not own preview ${previewId}`);
  }

  const target = {
    projectId: preview.projectId,
    previewId,
    pullRequestNumber: preview.pullRequestNumber,
  };
  const servers = hosts.hostsOf(database, listDeploymentServerIds(database, preview.projectId));
  const results: { containers: number; images: number }[] = [];
  await settleCleanup(
    servers,
    async (host) => {
      results.push(await removePreviewResources(host, target, assertActive));
    },
    assertActive,
  );
  logger.info(
    { previewId, pullRequestNumber: preview.pullRequestNumber, results },
    "closed preview removed",
  );
}
