import { describe, expect, test } from "bun:test";

import type { ContainerInfo } from "@/docker";

import { type HealthCheckTarget, type Probes, waitUntilHealthy } from "./health-check";

const RUNNING_CONTAINER: ContainerInfo = {
  id: "abc",
  name: "nelcota-api-0a1b2c3d4e5f",
  image: "nelcota/api:0a1b2c3d4e5f",
  status: "running",
  running: true,
  health: null,
  restartCount: 0,
  startedAt: "2026-10-28T12:00:00Z",
  labels: {},
  networkAddresses: { nelcota: "10.0.0.2" },
};

const unreachableProbes: Probes = {
  http: async () => await Promise.resolve(false),
  tcp: async () => await Promise.resolve(false),
};

function targetWith(overrides: Partial<HealthCheckTarget> = {}): HealthCheckTarget {
  return {
    containerName: RUNNING_CONTAINER.name,
    network: "nelcota",
    internalPort: 8080,
    healthCheckPath: null,
    timeoutInMs: 60_000,
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...overrides,
  };
}

function dockerReturning(info: ContainerInfo | null) {
  return { inspectContainer: async () => await Promise.resolve(info) };
}

async function failureMessageOf(waiting: Promise<void>): Promise<string> {
  const outcome = await waiting.then(
    () => null,
    (error: unknown) => error,
  );
  if (outcome instanceof Error) {
    return outcome.message;
  }
  throw new Error("Expected the health check to fail");
}

describe("waitUntilHealthy failures", () => {
  test("rejects when the container no longer exists", async () => {
    const docker = dockerReturning(null);

    const waiting = waitUntilHealthy(docker, targetWith(), unreachableProbes);

    expect(await failureMessageOf(waiting)).toContain(
      "Container disappeared during the health check",
    );
  });

  test("rejects when the container stopped", async () => {
    const docker = dockerReturning({ ...RUNNING_CONTAINER, running: false, status: "exited" });

    const waiting = waitUntilHealthy(docker, targetWith(), unreachableProbes);

    expect(await failureMessageOf(waiting)).toContain('Container stopped with status "exited"');
  });

  test("rejects when Docker reports the container as unhealthy", async () => {
    const docker = dockerReturning({ ...RUNNING_CONTAINER, health: "unhealthy" });

    const waiting = waitUntilHealthy(docker, targetWith(), unreachableProbes);

    expect(await failureMessageOf(waiting)).toContain("reported the container as unhealthy");
  });

  test("rejects when the health check is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const docker = dockerReturning(RUNNING_CONTAINER);

    const waiting = waitUntilHealthy(
      docker,
      targetWith({ signal: controller.signal }),
      unreachableProbes,
    );

    expect(await failureMessageOf(waiting)).toContain("Health check cancelled");
  });

  test("rejects with the timeout in seconds when the deadline already passed", async () => {
    const docker = dockerReturning(RUNNING_CONTAINER);

    const waiting = waitUntilHealthy(docker, targetWith({ timeoutInMs: 0 }), unreachableProbes);

    expect(await failureMessageOf(waiting)).toContain("did not become healthy within 0 seconds");
  });
});
