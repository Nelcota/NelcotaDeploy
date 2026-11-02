import type { Database } from "@/db";
import type { DockerEngine } from "@/docker";
import { listServers, recordServerCleanup } from "@/servers";

import type { WorkerDependencies } from "../worker.types";

const HOURS_PER_DAY = 24;

type CleanupDependencies = Pick<WorkerDependencies, "database" | "logger" | "config"> & {
  readonly hosts: {
    readonly hostOf: (
      database: Database,
      serverId: string,
    ) => { readonly docker: Pick<DockerEngine, "pruneBuildCache" | "pruneDanglingImages"> };
  };
};

/**
 * Frees disk on every reachable server: build cache unused for longer than the retention or
 * above the size limit, and dangling images of the platform. Unreachable servers are skipped
 * until the next run; a failure on one server never stops the others.
 *
 * @param dependencies - Database, server hosts, logger and the cache limits.
 */
export async function cleanUpServers(dependencies: CleanupDependencies): Promise<void> {
  const { database, hosts, logger, config } = dependencies;
  const ready = listServers(database).filter((server) => server.status === "ready");
  // One command at a time per server, and servers are few: each is an admin-added VPS.
  await Promise.all(
    ready.map(async (server) => {
      try {
        const { docker } = hosts.hostOf(database, server.id);
        const cacheBytes = await docker.pruneBuildCache({
          retentionInHours: config.BUILD_CACHE_RETENTION_DAYS * HOURS_PER_DAY,
          maxUsedSpaceInGb: config.BUILD_CACHE_MAX_GB,
        });
        const imageBytes = await docker.pruneDanglingImages();
        const freedBytes = cacheBytes + imageBytes;
        recordServerCleanup(database, server.id, { at: new Date(), freedBytes });
        logger.info({ serverId: server.id, freedBytes }, "server cleaned up");
      } catch (error) {
        logger.warn({ err: error, serverId: server.id }, "server cleanup failed");
      }
    }),
  );
}
