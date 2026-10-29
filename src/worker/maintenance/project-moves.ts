import { checkDomainsDns, listProjectDomains, projectServerAddress } from "@/domains";
import { listMoveLeftovers, type MoveLeftover } from "@/monitoring";
import { listServers } from "@/servers";
import { getSystemSettings } from "@/settings";

import { removeProjectResources } from "../container-action-runner";
import type { WorkerDependencies } from "../worker.types";

/** After this long on the new server, the old container goes even if DNS never changed. */
const MAX_OVERLAP_IN_MS = 86_400_000;

/**
 * Decides whether a moved project's old container can go: once every domain points at the
 * new server, or once the overlap lasted long enough (a CDN in front hides the real IP).
 *
 * @param input - Whether the `domainsMoved`, when the project went live on the new server
 *   (`liveSince`, UTC ISO 8601) and the current time.
 * @returns True when the old container can be removed.
 */
export function canFinishMove(input: {
  readonly domainsMoved: boolean;
  readonly liveSince: string | null;
  readonly now: Date;
}): boolean {
  if (input.domainsMoved) {
    return true;
  }
  if (input.liveSince == null) {
    return false;
  }
  const liveSince = new Date(input.liveSince);
  if (Number.isNaN(liveSince.getTime())) {
    return false;
  }
  return input.now.getTime() - liveSince.getTime() >= MAX_OVERLAP_IN_MS;
}

/** Tells whether every domain of the project already resolves to its new server. */
async function domainsMoved(
  dependencies: WorkerDependencies,
  leftover: MoveLeftover,
): Promise<boolean> {
  const { database } = dependencies;
  const domains = listProjectDomains(database, leftover.projectId, getSystemSettings(database));
  if (domains.length === 0) {
    return true;
  }
  const address = await projectServerAddress(
    database,
    leftover.projectId,
    dependencies.config.PUBLIC_URL,
  );
  if (address == null) {
    return false;
  }
  const checks = await checkDomainsDns(
    domains.map((domain) => domain.hostname),
    address,
  );
  return checks.every((check) => check.status === "ok");
}

function isStillLeftover(dependencies: WorkerDependencies, leftover: MoveLeftover): boolean {
  return listMoveLeftovers(dependencies.database).some(
    (current) =>
      current.projectId === leftover.projectId && current.otherServerId === leftover.otherServerId,
  );
}

/**
 * Removes the containers and images a moved project left on its previous server, once
 * traffic can no longer reach them (see {@link canFinishMove}).
 *
 * @remarks
 * Until then the old container keeps answering for clients whose DNS still points at the old
 * server, so moving a project never takes its site down.
 *
 * @param dependencies - Worker dependencies.
 * @param now - Current time.
 */
export async function finishProjectMoves(
  dependencies: WorkerDependencies,
  now: Date = new Date(),
): Promise<void> {
  const leftovers = listMoveLeftovers(dependencies.database);
  if (leftovers.length === 0) {
    return;
  }
  const servers = new Map(listServers(dependencies.database).map((server) => [server.id, server]));
  const results = await Promise.allSettled(
    leftovers.map(async (leftover) => {
      const previous = servers.get(leftover.otherServerId);
      if (previous?.status !== "ready") {
        return;
      }
      const moved = await domainsMoved(dependencies, leftover);
      if (canFinishMove({ domainsMoved: moved, liveSince: leftover.liveSince, now }) === false) {
        return;
      }
      // The DNS lookups took a while: the project may have moved back or started a deployment.
      if (isStillLeftover(dependencies, leftover) === false) {
        return;
      }
      const removed = await removeProjectResources(
        dependencies.hosts.hostFor(previous),
        leftover.projectId,
      );
      dependencies.logger.info(
        { projectId: leftover.projectId, serverId: previous.id, ...removed },
        "moved project removed from its previous server",
      );
    }),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      dependencies.logger.warn({ err: result.reason }, "could not finish a project move");
    }
  }
}
