import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import { DockerCli } from "@/docker";
import { GitClient } from "@/git";
import { createRemoteRunner, SshConnection } from "@/remote";
import { RouteFiles } from "@/routing";
import {
  getServer,
  listServers,
  LOCAL_SERVER_ID,
  REMOTE_ROUTES_DIR,
  REMOTE_WORKSPACE_DIR,
  type Server,
} from "@/servers";

import type { ServerHost } from "../worker.types";
import { createLocalHost } from "./local-host";
import { tunnelProbes } from "./tunnel-probes";

/** Docker binary on servers the install script prepared. */
export const REMOTE_DOCKER_BINARY = "docker";
const REMOTE_GIT_BINARY = "git";

type RemoteEntry = {
  readonly key: string;
  readonly host: ServerHost;
  readonly dispose: () => void;
};

// The host key is not part of the key: a connection pins the first key it sees by itself, so
// replacing it when that key is stored would only break commands running on it.
function connectionKey(server: Server): string {
  return [server.host, server.port, server.username].join("|");
}

/**
 * The hosts of every server, with one long-lived SSH connection per remote server.
 *
 * @remarks
 * Connections open on first use and are replaced when a server's address or account changes.
 */
export class ServerHosts implements Disposable {
  readonly #local: ServerHost;
  readonly #privateKey: string;
  readonly #remotes = new Map<string, RemoteEntry>();

  /**
   * Creates the host of the panel's own server; remote ones are created on first use.
   *
   * @param config - Worker configuration.
   * @param privateKey - The panel's SSH private key.
   * @throws {InvalidConfigError} When the proxy is enabled without a route directory.
   */
  constructor(config: AppConfig, privateKey: string) {
    this.#local = createLocalHost(config, LOCAL_SERVER_ID);
    this.#privateKey = privateKey;
  }

  /**
   * Returns the host of a server.
   *
   * @param server - Server row.
   * @returns Its host.
   * @throws {Error} When an SSH server has no address, port or username.
   */
  hostFor(server: Server): ServerHost {
    if (server.kind === "local") {
      return this.#local;
    }
    const key = connectionKey(server);
    const existing = this.#remotes.get(server.id);
    if (existing?.key === key) {
      return existing.host;
    }
    existing?.dispose();
    const entry = this.#createRemote(server, key);
    this.#remotes.set(server.id, entry);
    return entry.host;
  }

  /**
   * Returns the host of a server by id.
   *
   * @param database - Database.
   * @param serverId - Server id.
   * @returns Its host.
   * @throws {ServerNotFoundError} When the server does not exist.
   */
  hostOf(database: Database, serverId: string): ServerHost {
    return this.hostFor(getServer(database, serverId));
  }

  /**
   * Returns the hosts of the servers among the given ids that still exist.
   *
   * @param database - Database.
   * @param serverIds - Wanted server ids.
   * @returns Their hosts; removed servers are skipped.
   */
  hostsOf(database: Database, serverIds: readonly string[]): ServerHost[] {
    const wanted = new Set(serverIds);
    return listServers(database)
      .filter((server) => wanted.has(server.id))
      .map((server) => this.hostFor(server));
  }

  /**
   * Closes connections to servers that no longer exist.
   *
   * @param serverIds - Ids of the servers that exist now.
   */
  retain(serverIds: ReadonlySet<string>): void {
    for (const [serverId, entry] of this.#remotes) {
      if (serverIds.has(serverId) === false) {
        entry.dispose();
        this.#remotes.delete(serverId);
      }
    }
  }

  #createRemote(server: Server, key: string): RemoteEntry {
    if (server.host == null || server.port == null || server.username == null) {
      throw new Error(`Server ${server.id} has no SSH address`);
    }
    const connection = new SshConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      privateKey: this.#privateKey,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });
    const runner = createRemoteRunner(connection);
    const host: ServerHost = {
      serverId: server.id,
      runner,
      docker: new DockerCli(REMOTE_DOCKER_BINARY, runner),
      git: new GitClient(REMOTE_GIT_BINARY, runner),
      probes: tunnelProbes(connection),
      workspaceDir: REMOTE_WORKSPACE_DIR,
      platformProxy: true,
      routes: new RouteFiles(runner, REMOTE_ROUTES_DIR),
      connect: async () => await connection.connect(),
      hostKeyFingerprint: () => connection.hostKeyFingerprint,
    };
    return { key, host, dispose: () => connection[Symbol.dispose]() };
  }

  [Symbol.dispose](): void {
    for (const entry of this.#remotes.values()) {
      entry.dispose();
    }
    this.#remotes.clear();
  }
}
