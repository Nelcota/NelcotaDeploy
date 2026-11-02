import { describe, expect, test } from "bun:test";

import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { createLogger } from "@/logging";
import { getServer, LOCAL_SERVER_ID, recordServerCheck } from "@/servers";
import { FakeDocker } from "@/testing";

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

    expect(getServer(database, LOCAL_SERVER_ID).lastCleanupAt).toBeNull();
  });
});
