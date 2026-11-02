import { describe, expect, test } from "bun:test";

import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { createLogger } from "@/logging";
import {
  addServer,
  getServer,
  listServers,
  LOCAL_SERVER_ID,
  recordServerCheck,
  recordServerCleanup,
} from "@/servers";
import { FakeDocker, TEST_ACTOR } from "@/testing";

import { cleanUpServers } from "./server-cleanup";

const GIGABYTE = 1_000_000_000;

function setup(status: "ready" | "unreachable") {
  const database = openMemoryDatabase();
  recordServerCheck(database, LOCAL_SERVER_ID, { status, message: null, dockerVersion: "29" });
  const docker = new FakeDocker();
  docker.reclaimedBytes = GIGABYTE;
  const dependencies = {
    database,
    hosts: { hostOf: () => ({ docker }) },
    logger: createLogger("test"),
    config: { ...getConfig(), BUILD_CACHE_RETENTION_DAYS: 7, BUILD_CACHE_MAX_GB: 10 },
  };
  return { database, docker, dependencies };
}

describe("cleanUpServers", () => {
  test("prunes build cache within the configured limits", async () => {
    const { docker, dependencies } = setup("ready");

    await cleanUpServers(dependencies);

    expect(docker.calls).toContain("prune build cache 168h 10gb");
    expect(docker.calls).toContain("prune dangling images");
  });

  test("records what the cleanup freed on the server", async () => {
    const { database, dependencies } = setup("ready");

    await cleanUpServers(dependencies);

    const server = getServer(database, LOCAL_SERVER_ID);
    expect(server.lastCleanupFreedBytes).toBe(2 * GIGABYTE);
    expect(server.lastCleanupAt).not.toBeNull();
  });

  test("skips a server that cannot be reached", async () => {
    const { docker, dependencies } = setup("unreachable");

    await cleanUpServers(dependencies);

    expect(docker.calls).toEqual([]);
  });

  test("keeps the previous record when the cleanup fails", async () => {
    const { database, dependencies } = setup("ready");
    const previous = { at: new Date("2026-11-01T04:30:00Z"), freedBytes: GIGABYTE };
    recordServerCleanup(database, LOCAL_SERVER_ID, previous);
    const failing = {
      ...dependencies,
      hosts: {
        hostOf: () => ({
          docker: {
            pruneBuildCache: async () => await Promise.reject(new Error("docker unreachable")),
            pruneDanglingImages: async () => await Promise.resolve(0),
          },
        }),
      },
    };

    await cleanUpServers(failing);

    expect(getServer(database, LOCAL_SERVER_ID).lastCleanupAt).toBe(previous.at.toISOString());
    expect(getServer(database, LOCAL_SERVER_ID).lastCleanupFreedBytes).toBe(previous.freedBytes);
  });
});

test("limits concurrent cleanups while eventually cleaning every ready server", async () => {
  const { database, dependencies } = setup("ready");
  for (const suffix of [1, 2, 3, 4]) {
    const server = addServer(database, {
      input: { name: `apps-${suffix}`, host: `203.0.113.${suffix}`, port: 22, username: "nelcota" },
      actor: TEST_ACTOR,
    });
    recordServerCheck(database, server.id, { status: "ready", message: null, dockerVersion: "29" });
  }
  const gate = Promise.withResolvers<void>();
  let active = 0;
  let peak = 0;
  const hosts = {
    hostOf: () => ({
      docker: {
        pruneBuildCache: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await gate.promise;
          active -= 1;
          return GIGABYTE;
        },
        pruneDanglingImages: async () => await Promise.resolve(0),
      },
    }),
  };

  const cleanup = cleanUpServers({ ...dependencies, hosts });
  const initiallyActive = active;
  gate.resolve();
  await cleanup;

  expect(initiallyActive).toBe(3);
  expect(peak).toBe(3);
  expect(listServers(database).every((server) => server.lastCleanupFreedBytes === GIGABYTE)).toBe(
    true,
  );
});

test("continues cleaning other servers when one server fails", async () => {
  const { database, dependencies, docker } = setup("ready");
  const remote = addServer(database, {
    input: { name: "apps-1", host: "203.0.113.10", port: 22, username: "nelcota" },
    actor: TEST_ACTOR,
  });
  recordServerCheck(database, remote.id, { status: "ready", message: null, dockerVersion: "29" });
  const hosts = {
    hostOf: (_database: typeof database, serverId: string) => {
      if (serverId === LOCAL_SERVER_ID) {
        throw new Error("docker unavailable");
      }
      return { docker };
    },
  };

  await cleanUpServers({ ...dependencies, hosts });

  expect(getServer(database, LOCAL_SERVER_ID).lastCleanupAt).toBeNull();
  expect(getServer(database, remote.id).lastCleanupFreedBytes).toBe(2 * GIGABYTE);
});
