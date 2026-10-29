import {
  applicationServersReady,
  dedicatePanelHostIfUnused,
  listServers,
  LOCAL_SERVER_ID,
  recordServerCheck,
  type Server,
} from "@/servers";

import type { WorkerDependencies } from "../worker.types";
import { ContainerObserver } from "./container-observer";
import { HostSampler } from "./host-sampler";
import { checkServer } from "./server-checker";

/**
 * Every server the worker manages: their checks, and the container observer and host
 * sampler of each ready one.
 */
export class ServerFleet implements Disposable {
  readonly #dependencies: WorkerDependencies;
  readonly #observers = new Map<string, ContainerObserver>();
  readonly #samplers = new Map<string, HostSampler>();
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
    const servers = listServers(this.#dependencies.database);
    const existing = new Set(servers.map((server) => server.id));
    this.#dependencies.hosts.retain(existing);
    for (const server of this.#readyServers) {
      if (existing.has(server.id) === false) {
        this.#setReady(server, false);
      }
    }
    for (const server of servers) {
      if (this.#checking.has(server.id)) {
        continue;
      }
      this.#checking.add(server.id);
      this.#checkOne(server)
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
    const { database, hosts, config, logger } = this.#dependencies;
    const check = await checkServer(config, server, hosts.hostFor(server));
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
    // Only when a server works for the first time: later, the admin's choice stands.
    const firstTimeReady =
      server.kind === "ssh" && server.lastSeenAt == null && check.status === "ready";
    if (firstTimeReady && dedicatePanelHostIfUnused(database)) {
      logger.info("panel host dedicated to the panel; new projects go to the other servers");
    }
    this.#setReady(server, check.status === "ready");
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
    const { database, hosts, secretBox, logger } = this.#dependencies;
    const observer = new ContainerObserver({
      serverId: server.id,
      database,
      docker: hosts.hostFor(server).docker,
      secretBox,
      logger,
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
    if (server == null) {
      return;
    }
    await this.#observerFor(server).refresh();
  }

  /** Refreshes the containers of every ready server and follows their Docker events. */
  async refreshContainers(): Promise<void> {
    await Promise.all(
      this.#readyServers.map(async (server) => {
        const observer = this.#observerFor(server);
        observer.followEvents();
        await observer.refresh();
      }),
    );
  }

  /** Samples host and container usage of every ready server. */
  async collectMetrics(): Promise<void> {
    const { database, hosts } = this.#dependencies;
    await Promise.all(
      this.#readyServers.map(async (server) => {
        const host = hosts.hostFor(server);
        let sampler = this.#samplers.get(server.id);
        if (sampler == null) {
          sampler = new HostSampler(server.id);
          this.#samplers.set(server.id, sampler);
        }
        await sampler.sample(database, { runner: host.runner, diskPath: host.workspaceDir });
        await this.#observerFor(server).sampleMetrics();
      }),
    );
  }

  [Symbol.dispose](): void {
    for (const observer of this.#observers.values()) {
      observer[Symbol.dispose]();
    }
    this.#observers.clear();
  }
}
