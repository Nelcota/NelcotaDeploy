import { readBackupFile } from "@/backups";
import { type AppConfig, InvalidConfigError } from "@/config";
import { DockerCli } from "@/docker";
import { GitClient } from "@/git";
import { runProcess } from "@/process";
import { RouteFiles } from "@/routing";

import { networkProbes } from "../probes";
import type { ServerFiles, ServerHost } from "../server-host";

/** Files of the worker's own host; the limits match those of transfers over SSH. */
const localFiles: ServerFiles = {
  read: async (path, limits) => {
    const file = Bun.file(path);
    if (file.size > limits.maxBytes) {
      throw new Error(`File ${path} is larger than ${limits.maxBytes} bytes`);
    }
    return await readBackupFile(file, limits.maxBytes);
  },
  write: async (path, data) => {
    await Bun.write(path, data);
  },
};

function localRoutes(config: AppConfig): RouteFiles | null {
  if (config.TRAEFIK_ENABLED === false) {
    return null;
  }
  if (config.TRAEFIK_ROUTES_DIR == null) {
    throw new InvalidConfigError(
      "TRAEFIK_ENABLED needs TRAEFIK_ROUTES_DIR: the directory the panel's proxy reads routes from",
    );
  }
  return new RouteFiles(runProcess, config.TRAEFIK_ROUTES_DIR);
}

/**
 * Builds the host for the server the worker runs on.
 *
 * @param config - Worker configuration.
 * @param serverId - Id of the panel's own server.
 * @returns The local host.
 * @throws {InvalidConfigError} When the proxy is enabled without a route directory.
 */
export function createLocalHost(config: AppConfig, serverId: string): ServerHost {
  return {
    serverId,
    runner: runProcess,
    files: localFiles,
    docker: new DockerCli(config.DOCKER_BINARY),
    git: new GitClient(config.GIT_BINARY),
    railpackBinary: config.RAILPACK_BINARY,
    probes: networkProbes,
    workspaceDir: config.WORKSPACE_DIR,
    platformProxy: false,
    routes: localRoutes(config),
    connect: async () => {
      await Promise.resolve();
    },
    hostKeyFingerprint: () => null,
  };
}
