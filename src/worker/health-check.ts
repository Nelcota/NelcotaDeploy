import type { ContainerInfo, DockerEngine } from "@/docker";

const POLL_INTERVAL_IN_MS = 1000;
const PROBE_TIMEOUT_IN_MS = 3000;
const HTTP_SUCCESS_LIMIT = 400;
/** The container must keep running this long after the first successful probe. */
const STABILITY_WINDOW_IN_MS = 3000;

/** Thrown when a new container never becomes healthy. */
class HealthCheckFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthCheckFailedError";
  }
}

/** Network probes, replaceable in tests. */
export type Probes = {
  readonly http: (url: string) => Promise<boolean>;
  readonly tcp: (host: string, port: number) => Promise<boolean>;
};

/** Probes using fetch and Bun.connect. */
export const networkProbes: Probes = {
  async http(url) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_IN_MS),
      });
      await response.body?.cancel();
      return response.status < HTTP_SUCCESS_LIMIT;
    } catch {
      return false;
    }
  },
  async tcp(host, port) {
    try {
      const socket = await Promise.race([
        Bun.connect({ hostname: host, port, socket: { data() {} } }),
        Bun.sleep(PROBE_TIMEOUT_IN_MS).then(() => null),
      ]);
      if (socket == null) {
        return false;
      }
      socket.end();
      return true;
    } catch {
      return false;
    }
  },
};

/** What to check and for how long. */
export type HealthCheckTarget = {
  readonly containerName: string;
  readonly network: string;
  readonly internalPort: number;
  /** HTTP path to probe; a TCP connection is enough when null. */
  readonly healthCheckPath: string | null;
  readonly timeoutInMs: number;
  readonly signal: AbortSignal;
  readonly onProgress: (message: string) => void;
};

function describeExit(info: ContainerInfo): string {
  return `Container stopped with status "${info.status}" before becoming healthy`;
}

async function isReachable(
  info: ContainerInfo,
  target: HealthCheckTarget,
  probes: Probes,
): Promise<boolean> {
  if (info.health === "unhealthy") {
    throw new HealthCheckFailedError("Docker HEALTHCHECK reported the container as unhealthy");
  }
  // When the image defines a HEALTHCHECK, Docker's verdict is authoritative.
  if (info.health != null) {
    return info.health === "healthy";
  }
  const address = info.networkAddresses[target.network];
  if (address == null) {
    return false;
  }
  if (target.healthCheckPath == null) {
    return await probes.tcp(address, target.internalPort);
  }
  return await probes.http(`http://${address}:${target.internalPort}${target.healthCheckPath}`);
}

/**
 * Waits until a new container is running, answers on its port (or HTTP path, or Docker
 * HEALTHCHECK) and stays up for a short stability window.
 *
 * @param docker - Docker access.
 * @param target - Container, probe settings and timeout.
 * @param probes - Network probes.
 * @throws {HealthCheckFailedError} When the container exits, is unhealthy or the timeout passes.
 */
export async function waitUntilHealthy(
  docker: Pick<DockerEngine, "inspectContainer">,
  target: HealthCheckTarget,
  probes: Probes = networkProbes,
): Promise<void> {
  const deadline = Date.now() + target.timeoutInMs;
  let healthySince: number | null = null;
  let restartCount: number | null = null;
  while (Date.now() < deadline) {
    if (target.signal.aborted) {
      throw new HealthCheckFailedError("Health check cancelled");
    }
    const info = await docker.inspectContainer(target.containerName);
    if (info == null) {
      throw new HealthCheckFailedError("Container disappeared during the health check");
    }
    if (info.running === false) {
      throw new HealthCheckFailedError(describeExit(info));
    }
    restartCount ??= info.restartCount;
    if (info.restartCount !== restartCount) {
      throw new HealthCheckFailedError("Container restarted during the health check");
    }
    const reachable = await isReachable(info, target, probes);
    if (reachable === false) {
      healthySince = null;
    } else if (healthySince == null) {
      healthySince = Date.now();
      target.onProgress("Container is responding; checking stability");
    } else if (Date.now() - healthySince >= STABILITY_WINDOW_IN_MS) {
      return;
    }
    await Bun.sleep(POLL_INTERVAL_IN_MS);
  }
  throw new HealthCheckFailedError(
    `Container did not become healthy within ${Math.round(target.timeoutInMs / 1000)} seconds`,
  );
}
