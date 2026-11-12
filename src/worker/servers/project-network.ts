import type { AppConfig } from "@/config";
import { listProjectDatabases } from "@/databases";
import type { Database } from "@/db";
import { LABELS, PANEL_PROXY_CONTAINER, projectNetworkName, PROXY_CONTAINER_NAME } from "@/docker";

import type { ServerHost } from "../server-host";

type ProjectNetworkHost = Pick<ServerHost, "docker" | "platformProxy">;

function networkPeers(config: AppConfig, host: ProjectNetworkHost): string[] {
  if (host.platformProxy) {
    return [PROXY_CONTAINER_NAME];
  }

  const peers = config.TRAEFIK_ENABLED ? [PANEL_PROXY_CONTAINER] : [];
  if (config.WORKER_DOCKER_CONTAINER != null) {
    peers.push(config.WORKER_DOCKER_CONTAINER);
  }

  return peers;
}

/** Prepares the selected project's bridge and connects its existing managed databases. */
export async function prepareProjectNetwork(
  dependencies: {
    readonly config: AppConfig;
    readonly database: Database;
    readonly host: ProjectNetworkHost;
  },
  projectId: string,
  assertActive: () => void,
): Promise<string> {
  const { config, database, host } = dependencies;
  if (config.ISOLATED_PROJECT_IDS.includes(projectId) === false) {
    return config.DOCKER_NETWORK;
  }

  assertActive();
  await host.docker.networks.ensure(projectId);
  for (const peer of networkPeers(config, host)) {
    assertActive();
    await host.docker.networks.attach(projectId, peer);
  }

  const running = listProjectDatabases(database, projectId).filter(
    (record) => record.status === "running",
  );
  if (running.length === 0) {
    return projectNetworkName(projectId);
  }

  const containers = await host.docker.inspectContainers(running.map((record) => record.host));
  for (const container of containers) {
    if (
      container.labels[LABELS.managed] !== "true" ||
      container.labels[LABELS.databaseProjectId] !== projectId
    ) {
      throw new Error(`Refusing to attach unmanaged database container ${container.name}`);
    }

    assertActive();
    await host.docker.networks.attach(projectId, container.name);
  }

  return projectNetworkName(projectId);
}

/** Reattaches trusted ingress and probe containers after they are recreated. */
export async function restoreProjectNetworkPeers(
  config: AppConfig,
  host: ProjectNetworkHost,
): Promise<void> {
  const peers = networkPeers(config, host);
  if (peers.length === 0 || config.ISOLATED_PROJECT_IDS.length === 0) {
    return;
  }

  for (const projectId of await host.docker.networks.projects()) {
    for (const peer of peers) {
      await host.docker.networks.attach(projectId, peer);
    }
  }
}
