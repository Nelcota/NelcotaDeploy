import { notify } from "@/alerts";
import { type ContainerInfo, LABELS } from "@/docker";
import { listProjectIds } from "@/projects";
import {
  applicationServersReady,
  dedicatePanelHostIfUnused,
  listServers,
  getServer,
  ServerNotFoundError,
  LOCAL_SERVER_ID,
  recordServerCheck,
  type Server,
} from "@/servers";

import { removeProjectResources } from "../container-action-runner";
import type { WorkerDependencies } from "../worker.types";
import { ContainerObserver } from "./container-observer";
import { FleetOperations } from "./fleet-operations";
import { HostSampler } from "./host-sampler";
import { checkServer } from "./server-checker";

function sameServerIdentity(server: Server, current: Server): boolean {
  return (
    current.host === server.host &&
    current.port === server.port &&
    current.username === server.username &&
    current.kind === server.kind &&
    current.createdAt === server.createdAt
  );
}

/**
 * Finds the projects that no longer exist among the owners of a server's containers.
 *
 * @param containers - Platform containers on the server.
 * @param existing - Ids of the projects that exist.
 * @returns Ids of deleted projects that still have containers there.
 */
export function deletedProjectIds(
  containers: readonly ContainerInfo[],
  existing: ReadonlySet<string>,
): Set<string> {
  const deleted = new Set<string>();
  for (const container of containers) {
    const projectId =
      container.labels[LABELS.projectId] ?? container.labels[LABELS.databaseProjectId];
    if (projectId != null && existing.has(projectId) === false) {
      deleted.add(projectId);
    }
  }
  return deleted;
}

/**
 * Every server the worker manages: their checks, and the container observer and host
 * sampler of each ready one.
 */
export class ServerFleet implements Disposable {
  readonly #dependencies: WorkerDependencies;
  readonly #observers = new Map<string, ContainerObserver>();
  readonly #samplers = new Map<string, HostSampler>();
  readonly #operations = new FleetOperations();
  #disposed = false;
  /** Servers whose last check passed; only these are observed and sampled. */
  #readyServers: Server[] = [];
  #localDockerVersion: string | null = null;
  /** Servers whose check is running now. */
  readonly #checking = new Set<string>();
  /** Called when a server became ready, to observe it right away. */
  #onServerReady: () => void = () => undefined;

  constructor(dependencies: WorkerDependencies) {
    this.#dependencies = dependencies;
  }

  /** Docker version of the panel's own host, or null when its Docker is unreachable. */
  get localDockerVersion(): string | null {
    return this.#localDockerVersion;
  }

  /** Whether every server that takes or holds applications is ready. */
  applicationsReady(): boolean {
    return applicationServersReady(this.#dependencies.database);
  }

  /**
   * Sets what to do when a server becomes ready.
   *
   * @param listener - Usually a container refresh.
   */
  onServerReady(listener: () => void): void {
    this.#onServerReady = listener;
  }

  /**
   * Starts a check of every server that is not being checked already. Each server is checked
   * on its own, so one that is slow (pulling the proxy image, or timing out) never delays the
   * others; the call returns at once.
   */
  check(): void {
    if (this.#disposed) {
      return;
    }
    const servers = listServers(this.#dependencies.database);
    const existing = new Map(servers.map((server) => [server.id, server]));
    this.#dependencies.hosts.retain(new Set(existing.keys()));
    for (const server of this.#readyServers) {
      const current = existing.get(server.id);
      if (current == null || sameServerIdentity(server, current) === false) {
        this.#setReady(server, false);
      }
    }
    for (const server of servers) {
      if (this.#checking.has(server.id)) {
        continue;
      }
      this.#checking.add(server.id);
      this.#operations
        .run(`check:${server.id}`, async () => await this.#checkOne(server))
        .catch((error: unknown) =>
          this.#dependencies.logger.error(
            { err: error, serverId: server.id },
            "server check failed",
          ),
        )
        .finally(() => this.#checking.delete(server.id));
    }
  }

  async #checkOne(server: Server): Promise<void> {
    if (this.#isCurrent(server) === false) {
      return;
    }
    const { database, hosts, config, logger } = this.#dependencies;
    const check = await checkServer(config, server, hosts.hostFor(server));
    if (this.#isCurrent(server) === false) {
      return;
    }
    recordServerCheck(database, server.id, check);
    if (check.status !== server.status) {
      logger.info(
        { serverId: server.id, from: server.status, to: check.status, reason: check.message },
        "server status changed",
      );
    }
    if (server.id === LOCAL_SERVER_ID) {
      this.#localDockerVersion = check.dockerVersion;
    }
    await this.#alertOnChange(server, check.status);
    if (this.#isCurrent(server) === false) {
      return;
    }
    // Only when a server works for the first time: later, the admin's choice stands.
    const firstTimeReady =
      server.kind === "ssh" && server.lastSeenAt == null && check.status === "ready";
    if (firstTimeReady && dedicatePanelHostIfUnused(database)) {
      logger.info("panel host dedicated to the panel; new projects go to the other servers");
    }
    this.#setReady(server, check.status === "ready");
  }

  /** Tells the admins when a server that worked goes down, and when it comes back. */
  async #alertOnChange(server: Server, status: Server["status"]): Promise<void> {
    const { database, logger, config } = this.#dependencies;
    const link = `${config.PUBLIC_URL}/settings/servers`;
    if (server.status === "ready" && status === "unreachable") {
      await notify(database, logger, {
        title: "Server unreachable",
        text: `The panel lost access to ${server.name}.`,
        link,
      });
    }
    if (server.status === "unreachable" && status === "ready") {
      await notify(database, logger, {
        title: "Server back online",
        text: `${server.name} is responding again.`,
        link,
      });
    }
  }

  /** Starts or stops observing a server after its check. */
  #setReady(server: Server, ready: boolean): void {
    const others = this.#readyServers.filter((candidate) => candidate.id !== server.id);
    if (ready) {
      const becameReady = this.#observers.has(server.id) === false;
      this.#readyServers = [...others, server];
      if (becameReady) {
        this.#onServerReady();
      }
      return;
    }
    this.#readyServers = others;
    this.#observers.get(server.id)?.[Symbol.dispose]();
    this.#observers.delete(server.id);
    this.#samplers.delete(server.id);
  }

  #observerFor(server: Server): ContainerObserver {
    const existing = this.#observers.get(server.id);
    if (existing != null) {
      return existing;
    }
    const { database, hosts, secretBox, logger, config } = this.#dependencies;
    const observer = new ContainerObserver({
      serverId: server.id,
      database,
      docker: hosts.hostFor(server).docker,
      secretBox,
      logger,
      runtimeLinesPerProject: config.RUNTIME_LOG_RETENTION_LINES,
      isActive: () => this.#isCurrent(server, true),
    });
    this.#observers.set(server.id, observer);
    return observer;
  }

  /**
   * Refreshes the containers of one server, when it is ready.
   *
   * @param serverId - Server a job just changed.
   */
  async refreshServer(serverId: string): Promise<void> {
    const server = this.#readyServers.find((candidate) => candidate.id === serverId);
    if (server == null || this.#isCurrent(server, true) === false) {
      return;
    }
    await this.#observerFor(server).refresh();
  }

  /**
   * Refreshes the containers of every ready server, follows their Docker events and removes
   * what deleted projects left on servers that were unreachable when they were deleted.
   */
  async refreshContainers(): Promise<void> {
    await this.#runOnReadyServers("containers", async (server) => {
      const observer = this.#observerFor(server);
      observer.followEvents();
      const containers = await observer.refresh();
      if (this.#isCurrent(server, true) === false) {
        return;
      }
      await this.#removeDeletedProjects(server, containers);
    });
  }

  async #removeDeletedProjects(
    server: Server,
    containers: readonly ContainerInfo[],
  ): Promise<void> {
    const { database, hosts, logger } = this.#dependencies;
    const deleted = deletedProjectIds(containers, listProjectIds(database));
    const host = hosts.hostFor(server);
    const failures: unknown[] = [];
    for (const projectId of deleted) {
      if (this.#isCurrent(server, true) === false) {
        return;
      }
      try {
        const removed = await removeProjectResources(host, projectId);
        logger.info(
          { projectId, serverId: server.id, ...removed },
          "removed what a deleted project left on a server",
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Deleted project cleanup failed on server ${server.id}`);
    }
  }

  /** Samples host and container usage of every ready server. */
  async collectMetrics(): Promise<void> {
    const { database, hosts } = this.#dependencies;
    await this.#runOnReadyServers("metrics", async (server) => {
      const host = hosts.hostFor(server);
      let sampler = this.#samplers.get(server.id);
      if (sampler == null) {
        sampler = new HostSampler(server.id);
        this.#samplers.set(server.id, sampler);
      }
      await sampler.sample(database, {
        runner: host.runner,
        diskPath: host.workspaceDir,
        isActive: () => this.#isCurrent(server, true),
      });
      if (this.#isCurrent(server, true) === false) {
        return;
      }
      await this.#observerFor(server).sampleMetrics();
    });
  }

  #isCurrent(server: Server, requireReady = false): boolean {
    if (this.#disposed) {
      return false;
    }
    try {
      const current = getServer(this.#dependencies.database, server.id);
      return (
        sameServerIdentity(server, current) &&
        (requireReady === false || current.status === "ready")
      );
    } catch (error) {
      if (error instanceof ServerNotFoundError) {
        return false;
      }
      throw error;
    }
  }

  async #runOnReadyServers(name: string, run: (server: Server) => Promise<void>): Promise<void> {
    const results = await Promise.allSettled(
      this.#readyServers.map(async (server) => {
        await this.#operations.run(`${name}:${server.id}`, async () => {
          if (this.#isCurrent(server, true)) {
            await run(server);
          }
        });
      }),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, `Fleet ${name} failed`);
    }
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#operations[Symbol.dispose]();
    this.#readyServers = [];
    this.#samplers.clear();
    this.#onServerReady = () => undefined;
    for (const observer of this.#observers.values()) {
      observer[Symbol.dispose]();
    }
    this.#observers.clear();
  }
}
