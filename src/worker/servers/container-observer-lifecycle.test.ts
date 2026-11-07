import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { managedLabels } from "@/docker";
import { createLogger } from "@/logging";
import { createTestProject, createTestSecretBox, FakeDocker } from "@/testing";

import { ContainerObserver } from "./container-observer";

test("coalesces overlapping refreshes and never follows or stores a disposed refresh", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const docker = new FakeDocker();
  await docker.runContainer(
    {
      containerName: "live",
      imageTag: "nelcota/api:test",
      network: "test",
      labels: managedLabels({
        projectId: project.id,
        projectSlug: project.slug,
        deploymentId: "test",
        previewId: null,
      }),
      environmentKeys: [],
      volumes: [],
    },
    {},
  );
  const containers = await docker.listManagedContainers();
  const pending = Promise.withResolvers<typeof containers>();
  let lists = 0;
  let followers = 0;
  docker.listManagedContainers = async () => {
    lists += 1;
    return await pending.promise;
  };
  docker.followContainerLogs = () => {
    followers += 1;
    return Promise.resolve();
  };
  using observer = new ContainerObserver({
    serverId: "local",
    database,
    docker,
    secretBox: await createTestSecretBox(),
    logger: createLogger("test"),
  });
  const first = observer.refresh();
  const second = observer.refresh();
  observer[Symbol.dispose]();
  pending.resolve(containers);
  expect(await first).toEqual([]);
  expect(await second).toEqual([]);
  expect(await observer.refresh()).toEqual([]);
  expect(lists).toBe(1);
  expect(followers).toBe(0);
  expect(database.select().from(tables.containerSnapshots).all()).toEqual([]);
});

test("queues one trailing read for overlapping refreshes so a newer container state wins", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const pending = Promise.withResolvers<[]>();
  const docker = new FakeDocker();
  let lists = 0;
  docker.listManagedContainers = async () => {
    lists += 1;
    if (lists === 1) {
      return await pending.promise;
    }
    return [];
  };
  using observer = new ContainerObserver({
    serverId: "local",
    database,
    docker,
    secretBox: await createTestSecretBox(),
    logger: createLogger("test"),
  });
  const first = observer.refresh();
  const second = observer.refresh();
  const third = observer.refresh();
  expect(lists).toBe(1);
  pending.resolve([]);
  await Promise.all([first, second, third]);
  expect(lists).toBe(2);
});

test("allows a new refresh after the shared read rejects", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const docker = new FakeDocker();
  docker.listManagedContainers = () => Promise.reject(new Error("Docker unavailable"));
  using observer = new ContainerObserver({
    serverId: "local",
    database,
    docker,
    secretBox: await createTestSecretBox(),
    logger: createLogger("test"),
  });
  const failure: unknown = await observer.refresh().catch((error: unknown) => error);
  expect(failure).toEqual(new Error("Docker unavailable"));
  docker.listManagedContainers = () => Promise.resolve([]);
  expect(await observer.refresh()).toEqual([]);
});
