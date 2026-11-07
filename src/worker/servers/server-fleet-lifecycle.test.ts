import { expect, spyOn, test } from "bun:test";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { openMemoryDatabase, tables } from "@/db";
import { createLogger } from "@/logging";
import type { ProcessResult } from "@/process";
import { createTestSecretBox, FakeDocker } from "@/testing";

import { createLocalHost } from "./local-host";
import { ServerFleet } from "./server-fleet";
import { ServerHosts } from "./server-hosts";

const READING: ProcessResult = {
  exitCode: 0,
  stdout: "cpu 1 2 3 4 5 6 7 8\n",
  stderr: "",
  aborted: false,
  timedOut: false,
};

async function fixture(secondServer = false) {
  const database = openMemoryDatabase();
  const config = getConfig();
  const docker = new FakeDocker();
  const host = { ...createLocalHost(config, "local"), docker, routes: null };
  const hosts = new ServerHosts(config, "unused-key");
  const hostFor = spyOn(hosts, "hostFor").mockImplementation(() => host);
  if (secondServer) {
    database
      .insert(tables.servers)
      .values({
        id: "second",
        name: "Second",
        kind: "local",
        status: "ready",
        lastSeenAt: "2026-11-06T00:00:00.000Z",
        createdAt: "2026-11-06T00:00:00.000Z",
        updatedAt: "2026-11-06T00:00:00.000Z",
      })
      .run();
  }
  const fleet = new ServerFleet({
    database,
    config,
    hosts,
    secretBox: await createTestSecretBox(),
    logger: createLogger("test"),
    offsiteStore: null,
    workerId: "test",
  });
  const ready = Promise.withResolvers<void>();
  let readyCount = 0;
  fleet.onServerReady(() => {
    readyCount += 1;
    if (readyCount === (secondServer ? 2 : 1)) {
      ready.resolve();
    }
  });
  return {
    database,
    docker,
    host,
    hostFor,
    fleet,
    ready: ready.promise,
    [Symbol.dispose]() {
      fleet[Symbol.dispose]();
      hostFor.mockRestore();
      hosts[Symbol.dispose]();
      database.$client.close();
    },
  };
}

test("keeps a fleet batch pending after one host fails and deduplicates its slow peer", async () => {
  using environment = await fixture(true);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<ProcessResult>();
  let slowReads = 0;
  environment.hostFor.mockImplementation((server) => ({
    ...environment.host,
    runner: async () => {
      if (server.id === "local") {
        throw new Error("Host read failed");
      }
      slowReads += 1;
      started.resolve();
      return await release.promise;
    },
  }));
  environment.fleet.check();
  await environment.ready;
  let settled = false;
  const first = environment.fleet
    .collectMetrics()
    .catch((error: unknown) => error)
    .then((result: unknown) => {
      settled = true;
      return result;
    });
  await started.promise;
  const second = environment.fleet.collectMetrics().catch((error: unknown) => error);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(slowReads).toBe(1);
  release.resolve(READING);
  expect(await first).toBeInstanceOf(AggregateError);
  expect(await second).toBeInstanceOf(AggregateError);
});

test.each(["dispose", "remove"] as const)(
  "does not recreate observers or write samples after %s during I/O",
  async (action) => {
    using environment = await fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<ProcessResult>();
    const lists = spyOn(environment.docker, "listManagedContainers");
    using _lists = { [Symbol.dispose]: () => lists.mockRestore() };
    environment.hostFor.mockImplementation(() => ({
      ...environment.host,
      runner: async () => {
        started.resolve();
        return await release.promise;
      },
    }));
    environment.fleet.check();
    await environment.ready;
    const collecting = environment.fleet.collectMetrics();
    await started.promise;
    if (action === "dispose") {
      environment.fleet[Symbol.dispose]();
    } else {
      environment.database.delete(tables.servers).where(eq(tables.servers.id, "local")).run();
    }
    release.resolve(READING);
    await collecting;
    await environment.fleet.refreshContainers();
    expect(lists).not.toHaveBeenCalled();
    expect(environment.database.select().from(tables.metricSamples).all()).toEqual([]);
  },
);

test("does not mark a server ready when its check completes after disposal", async () => {
  using environment = await fixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let ready = false;
  environment.fleet.onServerReady(() => {
    ready = true;
  });
  environment.host.connect = async () => {
    started.resolve();
    await release.promise;
  };
  environment.fleet.check();
  await started.promise;
  environment.fleet[Symbol.dispose]();
  release.resolve();
  const settleInMs = 0;
  await Bun.sleep(settleInMs);
  expect(ready).toBe(false);
  expect(environment.database.select().from(tables.servers).get()?.status).toBe("pending");
});
