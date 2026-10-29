import { and, count, eq, isNull, ne } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";

import { NoServerAvailableError } from "./server.errors";
import { countProjectsOn, getServer, listServers, LOCAL_SERVER_ID } from "./server.service";

type Candidate = {
  readonly status: string;
  readonly projects: number;
  readonly name: string;
};

/** Ready servers first, then the one with fewer projects, then by name for a stable order. */
function compareCandidates(first: Candidate, second: Candidate): number {
  const readiness = Number(second.status === "ready") - Number(first.status === "ready");
  if (readiness !== 0) {
    return readiness;
  }
  if (first.projects !== second.projects) {
    return first.projects - second.projects;
  }
  return first.name.localeCompare(second.name);
}

/**
 * Lists the servers that hold projects: placed there, or running their current deployment.
 *
 * @param database - Database.
 * @returns Server ids.
 */
function listServersInUse(database: Database): Set<string> {
  const rows = database
    .select({ placed: tables.projects.serverId, running: tables.deployments.serverId })
    .from(tables.projects)
    .leftJoin(tables.deployments, eq(tables.deployments.id, tables.projects.currentDeploymentId))
    .all();
  return new Set(
    rows.flatMap((row) => (row.running == null ? [row.placed] : [row.placed, row.running])),
  );
}

/**
 * Tells whether applications can run: at least one server takes them, and every server that
 * takes new projects or holds existing ones is ready. A server just added, still waiting for
 * its install command, does not count until it worked once or holds a project.
 *
 * @param database - Database.
 * @returns True when nothing blocks deployments.
 */
export function applicationServersReady(database: Database): boolean {
  const inUse = listServersInUse(database);
  const relevant = listServers(database).filter(
    (server) =>
      inUse.has(server.id) ||
      (server.acceptsApplications && (server.status !== "pending" || server.lastSeenAt != null)),
  );
  return relevant.length > 0 && relevant.every((server) => server.status === "ready");
}

/**
 * Stops placing new projects on the panel's host once the first other server is ready,
 * when the panel's host runs nothing yet. Adding a server for applications means the panel's
 * host should stay dedicated to the panel.
 *
 * @param database - Database.
 * @returns True when the panel's host stopped accepting applications.
 */
export function dedicatePanelHostIfUnused(database: Database): boolean {
  const local = getServer(database, LOCAL_SERVER_ID);
  if (local.acceptsApplications === false || countProjectsOn(database, LOCAL_SERVER_ID) > 0) {
    return false;
  }
  const readyRemote = database
    .select({ id: tables.servers.id })
    .from(tables.servers)
    .where(
      and(
        ne(tables.servers.kind, "local"),
        eq(tables.servers.status, "ready"),
        eq(tables.servers.acceptsApplications, true),
      ),
    )
    .get();
  if (readyRemote == null) {
    return false;
  }
  database.transaction((transaction) => {
    transaction
      .update(tables.servers)
      .set({ acceptsApplications: false, updatedAt: new Date().toISOString() })
      .where(eq(tables.servers.id, LOCAL_SERVER_ID))
      .run();
    recordAuditEvent(transaction, {
      actor: { type: "system", label: "Nelcota" },
      action: "server.update",
      targetType: "server",
      targetId: LOCAL_SERVER_ID,
      metadata: { acceptsApplications: false, reason: "first application server ready" },
    });
  });
  return true;
}

/**
 * Picks the server for a new project: among servers that accept applications, ready ones
 * first, then the one running the fewest projects.
 *
 * @param database - Database.
 * @returns Server id.
 * @throws {NoServerAvailableError} When every server refuses new applications.
 */
export function chooseServerForNewProject(database: Database): string {
  const candidates = database
    .select({
      id: tables.servers.id,
      status: tables.servers.status,
      name: tables.servers.name,
      projects: count(tables.projects.id),
    })
    .from(tables.servers)
    .leftJoin(
      tables.projects,
      and(
        eq(tables.projects.serverId, tables.servers.id),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .where(eq(tables.servers.acceptsApplications, true))
    .groupBy(tables.servers.id)
    .all();
  const [best] = candidates.toSorted(compareCandidates);
  if (best == null) {
    throw new NoServerAvailableError();
  }
  return best.id;
}

/**
 * Puts a project on another server for its next deployment. The running container stays
 * where it is until a deployment on the new server succeeds.
 *
 * @param database - Database.
 * @param change - Project, target server and who moves it.
 * @throws {ServerNotFoundError} When the server does not exist.
 */
export function assignProjectServer(
  database: Database,
  {
    projectId,
    serverId,
    actor,
  }: { readonly projectId: string; readonly serverId: string; readonly actor: Actor },
): void {
  const server = getServer(database, serverId);
  database.transaction((transaction) => {
    transaction
      .update(tables.projects)
      .set({ serverId, updatedAt: new Date().toISOString() })
      .where(eq(tables.projects.id, projectId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "project.move",
      targetType: "project",
      targetId: projectId,
      metadata: { serverId, serverName: server.name },
    });
  });
}
