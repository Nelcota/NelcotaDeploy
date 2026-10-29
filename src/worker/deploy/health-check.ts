import type { ContainerInfo, DockerEngine } from "@/docker";

import { networkProbes, type Probes } from "../probes";

const POLL_INTERVAL_IN_MS = 1000;
const MS_PER_SECOND = 1000;
/** The container must keep running this long after the first successful probe. */
const STABILITY_WINDOW_IN_MS = 3000;

/** Thrown when a new container never becomes healthy. */
class HealthCheckFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthCheckFailedError";
  }
}

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

type HealthCheckContext = {
  readonly docker: Pick<DockerEngine, "inspectContainer">;
  readonly target: HealthCheckTarget;
  readonly probes: Probes;
};

type PollState = {
  readonly deadline: number;
  /** When the container first answered in the current healthy streak. */
  readonly healthySince: number | null;
  /** Restart count seen on the first poll; any change means the container crashed. */
  readonly restartCount: number | null;
};

async function inspectRunningContainer(
  context: HealthCheckContext,
  expectedRestartCount: number | null,
): Promise<ContainerInfo> {
  if (context.target.signal.aborted) {
    throw new HealthCheckFailedError("Health check cancelled");
  }
  const info = await context.docker.inspectContainer(context.target.containerName);
  if (info == null) {
    throw new HealthCheckFailedError("Container disappeared during the health check");
  }
  if (info.running === false) {
    throw new HealthCheckFailedError(describeExit(info));
  }
  if (expectedRestartCount != null && info.restartCount !== expectedRestartCount) {
    throw new HealthCheckFailedError("Container restarted during the health check");
  }
  return info;
}

function nextHealthySince(
  reachable: boolean,
  healthySince: number | null,
  target: HealthCheckTarget,
): number | null {
  if (reachable === false) {
    return null;
  }
  if (healthySince != null) {
    return healthySince;
  }
  target.onProgress("Container is responding; checking stability");
  return Date.now();
}

// Polls one step at a time: each probe must finish before the next one starts.
async function pollUntilHealthy(context: HealthCheckContext, state: PollState): Promise<void> {
  if (Date.now() >= state.deadline) {
    const timeoutInSeconds = Math.round(context.target.timeoutInMs / MS_PER_SECOND);
    throw new HealthCheckFailedError(
      `Container did not become healthy within ${timeoutInSeconds} seconds`,
    );
  }
  const info = await inspectRunningContainer(context, state.restartCount);
  const reachable = await isReachable(info, context.target, context.probes);
  const healthySince = nextHealthySince(reachable, state.healthySince, context.target);
  if (healthySince != null && Date.now() - healthySince >= STABILITY_WINDOW_IN_MS) {
    return;
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await pollUntilHealthy(context, {
    deadline: state.deadline,
    healthySince,
    restartCount: info.restartCount,
  });
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
  await pollUntilHealthy(
    { docker, target, probes },
    { deadline: Date.now() + target.timeoutInMs, healthySince: null, restartCount: null },
  );
}
