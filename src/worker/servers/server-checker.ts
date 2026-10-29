import type { AppConfig } from "@/config";
import { ensureProxy } from "@/docker";
import { isPublicIpAddress, lookupWithTimeout } from "@/domains";
import { sharedRouteConfig } from "@/routing";
import { REMOTE_ROUTES_DIR, type Server, type ServerCheck } from "@/servers";

import type { ServerHost } from "../server-host";
import { REMOTE_DOCKER_BINARY } from "./server-hosts";

const COMMAND_TIMEOUT_IN_MS = 10_000;
const PROXY_HTTP_PORT = 80;

/**
 * Picks the first public address from `hostname -I` output.
 *
 * @param output - Space-separated addresses of the server's interfaces.
 * @returns The address, or null when every address is private or reserved.
 */
export function firstPublicAddress(output: string): string | null {
  return output.split(/\s+/).find((address) => isPublicIpAddress(address)) ?? null;
}

async function lookupPublicAddress(hostname: string): Promise<string | null> {
  try {
    const resolved = await lookupWithTimeout(hostname);
    return isPublicIpAddress(resolved.address) ? resolved.address : null;
  } catch {
    return null;
  }
}

/**
 * Finds the address DNS records of the server's projects should point at: the configured
 * address when it is a public IP, else a public address of one of its interfaces, else what
 * its hostname resolves to.
 */
async function detectPublicAddress(server: Server, host: ServerHost): Promise<string | null> {
  if (server.host != null && isPublicIpAddress(server.host)) {
    return server.host;
  }
  const interfaces = await host.runner(["hostname", "-I"], { timeoutInMs: COMMAND_TIMEOUT_IN_MS });
  const fromInterfaces = interfaces.exitCode === 0 ? firstPublicAddress(interfaces.stdout) : null;
  if (fromInterfaces != null || server.host == null) {
    return fromInterfaces;
  }
  return await lookupPublicAddress(server.host);
}

/**
 * Prepares a server reached over SSH for applications: the platform network, the proxy with
 * HTTPS, and a check that the SSH account may open tunnels, which health checks need.
 */
async function prepareRemoteServer(config: AppConfig, host: ServerHost): Promise<void> {
  await host.docker.ensureNetwork(config.DOCKER_NETWORK);
  await ensureRouting(config, host);
  if ((await host.probes.tcp("127.0.0.1", PROXY_HTTP_PORT)) === false) {
    throw new Error(
      "The SSH account cannot open tunnels (AllowTcpForwarding); run the install command again",
    );
  }
}

function failedStatus(server: Server): ServerCheck["status"] {
  // A server that never worked stays pending: the install command probably has not run yet.
  return server.status === "pending" && server.lastSeenAt == null ? "pending" : "unreachable";
}

/**
 * Keeps a remote server's proxy current: writes the shared routes first, which also creates
 * the route directory with the panel's account as owner, then starts or replaces the proxy.
 */
async function ensureRouting(config: AppConfig, host: ServerHost): Promise<void> {
  // Routes on servers the platform set up compress responses themselves.
  await host.routes?.writeShared(sharedRouteConfig(true));
  await ensureProxy(host.runner, REMOTE_DOCKER_BINARY, {
    network: config.DOCKER_NETWORK,
    httpEntrypoint: config.TRAEFIK_HTTP_ENTRYPOINT,
    httpsEntrypoint: config.TRAEFIK_HTTPS_ENTRYPOINT,
    certResolver: config.TRAEFIK_CERT_RESOLVER,
    acmeEmail: config.ACME_EMAIL ?? null,
    routesDirectory: REMOTE_ROUTES_DIR,
  });
}

/**
 * Connects to a server and reports whether applications can run there. A server that was
 * not ready is prepared first (network, proxy, tunnels) and its public address detected.
 *
 * @param config - Worker configuration.
 * @param server - Server row.
 * @param host - Its host.
 * @returns The check to record; failures are reported in it, never thrown.
 */
export async function checkServer(
  config: AppConfig,
  server: Server,
  host: ServerHost,
): Promise<ServerCheck> {
  try {
    await host.connect();
    const dockerVersion = await host.docker.serverVersion();
    if (dockerVersion == null) {
      return {
        status: failedStatus(server),
        message: "Docker is not running or the account is not in the docker group",
        dockerVersion: null,
      };
    }
    if (server.kind === "local") {
      // The panel's proxy compresses on its entrypoint, so its routes do not.
      await host.routes?.writeShared(sharedRouteConfig(false));
      return { status: "ready", message: null, dockerVersion };
    }
    if (server.status === "ready") {
      // Cheap when nothing changed; replaces a proxy left by an older version of the panel.
      await ensureRouting(config, host);
      return { status: "ready", message: null, dockerVersion };
    }
    await prepareRemoteServer(config, host);
    return {
      status: "ready",
      message: null,
      dockerVersion,
      hostKeyFingerprint: host.hostKeyFingerprint(),
      publicAddress: await detectPublicAddress(server, host),
    };
  } catch (error) {
    return {
      status: failedStatus(server),
      message: error instanceof Error ? error.message : String(error),
      dockerVersion: null,
    };
  }
}
