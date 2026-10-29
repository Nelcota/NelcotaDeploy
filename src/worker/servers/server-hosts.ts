import type { AppConfig } from "@/config";
import type { Database } from "@/db";
import { DockerCli, type DockerEngine } from "@/docker";
import { GitClient } from "@/git";
import { type CommandRunner, runProcess } from "@/process";
import { createRemoteRunner, SshConnection } from "@/remote";
import { getServer, listServers, REMOTE_WORKSPACE_DIR, type Server } from "@/servers";

import { networkProbes, type Probes } from "../probes";
import { tunnelProbes } from "./tunnel-probes";

/** Docker binary on servers the install script prepared. */
export const REMOTE_DOCKER_BINARY = "docker";
const REMOTE_GIT_BINARY = "git";

/** Everything the worker uses to work on one server, wherever it is. */
export type ServerHost = {
  readonly serverId: string;
  /** Runs commands on the server. */
  readonly runner: CommandRunner;
  readonly docker: DockerEngine;
  readonly git: Pick<GitClient, "checkoutRevision">;
  /** Health probes that reach containers on the server's Docker network. */
  readonly probes: Probes;
  /** Where builds run on the server; its filesystem is the disk reported for the server. */
  readonly workspaceDir: string;
  /**
   * Whether the platform runs this server's proxy itself (servers reached over SSH). That
   * proxy always routes, and does not compress on its entrypoint like the panel's own does,
   * so application containers bring their own compression middleware.
   */
  readonly platformProxy: boolean;
  /** Opens the connection now; does nothing for the local host. */
  readonly connect: () => Promise<void>;
  /** Host key the server presented on the last connection; null for the local host. */
  readonly hostKeyFingerprint: () => string | null;
};

type RemoteEntry = {
  readonly key: string;
  readonly host: ServerHost;
  readonly dispose: () => void;
};

/**
 * Builds the host for the server the worker runs on.
 *
 * @param config - Worker configuration.
 * @param serverId - Id of the panel's own server.
 * @returns The local host.
 */
export function createLocalHost(config: AppConfig, serverId: string): ServerHost {
  return {
    serverId,
    runner: runProcess,
    docker: new DockerCli(config.DOCKER_BINARY),
    git: new GitClient(config.GIT_BINARY),
    probes: networkProbes,
    workspaceDir: config.WORKSPACE_DIR,
    platformProxy: false,
    connect: async () => {
      await Promise.resolve();
    },
    hostKeyFingerprint: () => null,
  };
}

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
   * @param local - Host of the panel's own server.
   * @param privateKey - The panel's SSH private key.
   */
  constructor(local: ServerHost, privateKey: string) {
    this.#local = local;
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
