import { and, asc, count, eq, sql } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import type { ServerInput } from "@/shared/schemas/server.schema";

import { ServerInUseError, ServerNotFoundError, ServerTakenError } from "./server.errors";

/** Id of the panel's own host, which always exists. */
export const LOCAL_SERVER_ID = tables.LOCAL_SERVER_ID;

const serverColumns = {
  id: tables.servers.id,
  name: tables.servers.name,
  kind: tables.servers.kind,
  host: tables.servers.host,
  port: tables.servers.port,
  username: tables.servers.username,
  hostKeyFingerprint: tables.servers.hostKeyFingerprint,
  publicAddress: tables.servers.publicAddress,
  acceptsApplications: tables.servers.acceptsApplications,
  status: tables.servers.status,
  statusMessage: tables.servers.statusMessage,
  dockerVersion: tables.servers.dockerVersion,
  lastSeenAt: tables.servers.lastSeenAt,
  createdAt: tables.servers.createdAt,
};

/** A server applications run on: the panel's own host or another VPS reached over SSH. */
export type Server = {
  readonly id: string;
  readonly name: string;
  readonly kind: "local" | "ssh";
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly hostKeyFingerprint: string | null;
  readonly publicAddress: string | null;
  readonly acceptsApplications: boolean;
  readonly status: "pending" | "ready" | "unreachable";
  readonly statusMessage: string | null;
  readonly dockerVersion: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
};

/** Result of the worker checking a server. */
export type ServerCheck = {
  readonly status: Server["status"];
  /** Why the server is not ready, in English for the logs; null when ready. */
  readonly message: string | null;
  readonly dockerVersion: string | null;
  /** Host key seen on a check that passed; only stored while none is pinned yet. */
  readonly hostKeyFingerprint?: string | null;
  readonly publicAddress?: string | null;
};

/**
 * Lists every server, the panel's own host first.
 *
 * @param database - Database.
 * @returns Servers.
 */
export function listServers(database: Database): Server[] {
  return database
    .select(serverColumns)
    .from(tables.servers)
    .orderBy(sql`${tables.servers.kind} = 'local' DESC`, asc(tables.servers.name))
    .all();
}

/**
 * Reads one server.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @returns The server.
 * @throws {ServerNotFoundError} When the server does not exist.
 */
export function getServer(database: Database, serverId: string): Server {
  const server = database
    .select(serverColumns)
    .from(tables.servers)
    .where(eq(tables.servers.id, serverId))
    .get();
  if (server == null) {
    throw new ServerNotFoundError(serverId);
  }
  return server;
}

/**
 * Registers a server reached over SSH. The worker connects to it on its own, pins its host
 * key and prepares it (network and proxy) as soon as the install script has run there.
 *
 * @param database - Database.
 * @param addition - Validated connection settings and who adds the server.
 * @returns The new server, still pending.
 * @throws {ServerTakenError} When the name or the address and port are already used.
 */
export function addServer(
  database: Database,
  { input, actor }: { readonly input: ServerInput; readonly actor: Actor },
): Server {
  const serverId = Bun.randomUUIDv7();
  const now = new Date().toISOString();
  database.transaction((transaction) => {
    const sameName = transaction
      .select({ id: tables.servers.id })
      .from(tables.servers)
      .where(eq(tables.servers.name, input.name))
      .get();
    if (sameName != null) {
      throw new ServerTakenError("name");
    }
    const sameAddress = transaction
      .select({ id: tables.servers.id })
      .from(tables.servers)
      .where(and(eq(tables.servers.host, input.host), eq(tables.servers.port, input.port)))
      .get();
    if (sameAddress != null) {
      throw new ServerTakenError("address");
    }
    transaction
      .insert(tables.servers)
      .values({
        id: serverId,
        name: input.name,
        kind: "ssh",
        host: input.host,
        port: input.port,
        username: input.username,
        acceptsApplications: true,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "server.add",
      targetType: "server",
      targetId: serverId,
      metadata: { name: input.name, host: input.host, port: input.port },
    });
  });
  return getServer(database, serverId);
}

/**
 * Sets whether new projects may be placed on a server automatically.
 *
 * @param database - Database.
 * @param change - Server, new value and who changes it.
 * @throws {ServerNotFoundError} When the server does not exist.
 */
export function setServerAcceptsApplications(
  database: Database,
  {
    serverId,
    acceptsApplications,
    actor,
  }: { readonly serverId: string; readonly acceptsApplications: boolean; readonly actor: Actor },
): void {
  getServer(database, serverId);
  database.transaction((transaction) => {
    transaction
      .update(tables.servers)
      .set({ acceptsApplications, updatedAt: new Date().toISOString() })
      .where(eq(tables.servers.id, serverId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "server.update",
      targetType: "server",
      targetId: serverId,
      metadata: { acceptsApplications },
    });
  });
}

/**
 * Counts the projects that live on a server: placed there for their next deployment, or
 * running a deployment there now.
 *
 * @param database - Database.
 * @param serverId - Server id.
 * @returns Number of projects.
 */
export function countProjectsOn(database: Database, serverId: string): number {
  const row = database
    .select({ total: count() })
    .from(tables.projects)
    .leftJoin(tables.deployments, eq(tables.deployments.id, tables.projects.currentDeploymentId))
    .where(
      sql`${tables.projects.serverId} = ${serverId} OR ${tables.deployments.serverId} = ${serverId}`,
    )
    .get();
  return row?.total ?? 0;
}

/**
 * Removes a server the platform no longer uses. Its containers and images must be gone, so
 * every project on it has to move or be deleted first.
 *
 * @param database - Database.
 * @param removal - Server and who removes it.
 * @throws {ServerNotFoundError} When the server does not exist.
 * @throws {ServerInUseError} When it is the panel's own host or still hosts projects.
 */
export function removeServer(
  database: Database,
  { serverId, actor }: { readonly serverId: string; readonly actor: Actor },
): void {
  const server = getServer(database, serverId);
  if (server.kind === "local") {
    throw new ServerInUseError(serverId, "it is the panel's own host");
  }
  if (countProjectsOn(database, serverId) > 0) {
    throw new ServerInUseError(serverId, "projects still run on it");
  }
  // A moved project's old container stays until its domains point at the new server.
  const leftover = database
    .select({ containerId: tables.containerSnapshots.containerId })
    .from(tables.containerSnapshots)
    .where(eq(tables.containerSnapshots.serverId, serverId))
    .get();
  if (leftover != null) {
    throw new ServerInUseError(serverId, "containers of moved projects still run on it");
  }
  database.transaction((transaction) => {
    transaction.delete(tables.servers).where(eq(tables.servers.id, serverId)).run();
    recordAuditEvent(transaction, {
      actor,
      action: "server.remove",
      targetType: "server",
      targetId: serverId,
      metadata: { name: server.name, host: server.host },
    });
  });
}

/**
 * Stores what the worker found when it checked a server.
 *
 * @remarks
 * The host key fingerprint is stored only while none is pinned: after the first successful
 * connection, a different key is refused by the connection itself.
 *
 * @param database - Database.
 * @param serverId - Checked server.
 * @param check - Status, Docker version and what was learned about the host.
 */
export function recordServerCheck(database: Database, serverId: string, check: ServerCheck): void {
  const timestamp = new Date().toISOString();
  database
    .update(tables.servers)
    .set({
      status: check.status,
      statusMessage: check.message,
      dockerVersion: check.dockerVersion,
      ...(check.status === "ready" ? { lastSeenAt: timestamp } : {}),
      ...(check.publicAddress == null ? {} : { publicAddress: check.publicAddress }),
      ...(check.hostKeyFingerprint == null
        ? {}
        : {
            hostKeyFingerprint: sql`COALESCE(${tables.servers.hostKeyFingerprint}, ${check.hostKeyFingerprint})`,
          }),
      updatedAt: timestamp,
    })
    .where(eq(tables.servers.id, serverId))
    .run();
}
