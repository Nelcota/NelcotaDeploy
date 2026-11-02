import { describe, expect, test } from "bun:test";

import { createProjectDatabase, listProjectDatabases, requestDatabaseDeletion } from "@/databases";
import { openMemoryDatabase } from "@/db";
import { LABELS } from "@/docker";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { deleteDatabase, provisionDatabase } from "./database-runner";

const QUICK_READINESS = { timeoutInMs: 50, intervalInMs: 1 };
const SIGNAL_TIMEOUT_IN_MS = 1000;

async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const docker = new FakeDocker();
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const dependencies = {
    database,
    docker,
    secretBox,
    network: "nelcota",
    readiness: QUICK_READINESS,
  };
  const status = () => listProjectDatabases(database, project.id)[0];
  return { database, project, docker, created, dependencies, status };
}

describe("provisionDatabase", () => {
  test("starts the database on the platform network with its data volume", async () => {
    const { project, docker, created, dependencies } = await setup();

    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    const container = docker.containers.get(created.host);
    expect(container?.image).toBe("postgres:18.6-alpine");
    expect(container?.networkAddresses).toHaveProperty("nelcota");
    expect(container?.labels[LABELS.databaseProjectId]).toBe(project.id);
    expect(container?.labels[LABELS.projectId]).toBeUndefined();
    expect(docker.mounts.get(created.host)?.[0]?.target).toBe("/var/lib/postgresql");
  });

  test("passes the password through the environment", async () => {
    const { docker, created, dependencies } = await setup();

    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    const password = docker.environments.get(created.host)?.["POSTGRES_PASSWORD"];
    expect(password).toHaveLength(48);
  });

  test("marks the database running once it accepts connections", async () => {
    const { created, dependencies, status } = await setup();

    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    expect(status()?.status).toBe("running");
  });

  test("leaves a container that already runs in place", async () => {
    const { docker, created, dependencies } = await setup();
    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    expect(docker.calls.filter((call) => call.startsWith("run "))).toHaveLength(1);
  });

  test("marks the database failed when its container stops while starting", async () => {
    const { docker, created, dependencies, status } = await setup();
    docker.containersStayUp = false;

    const provision = provisionDatabase(
      dependencies,
      created.id,
      AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS),
    );

    const error = await provision.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("stopped while starting");
    expect(status()?.status).toBe("failed");
  });

  test("does nothing for a database being deleted", async () => {
    const { database, project, docker, created, dependencies } = await setup();
    requestDatabaseDeletion(database, {
      projectId: project.id,
      databaseId: created.id,
      actor: TEST_ACTOR,
    });

    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    expect(docker.containers.size).toBe(0);
  });
});

describe("deleteDatabase", () => {
  test("removes the container, its data and the database", async () => {
    const { project, docker, created, dependencies, status } = await setup();
    await provisionDatabase(dependencies, created.id, AbortSignal.timeout(SIGNAL_TIMEOUT_IN_MS));

    await deleteDatabase({ ...dependencies, storage: null }, created.id);

    expect(docker.containers.size).toBe(0);
    expect(await docker.volumes.listForProject(project.id)).toEqual([]);
    expect(status()).toBeUndefined();
  });

  test("deletes the stored backups of the database", async () => {
    const { created, dependencies } = await setup();
    const objects = new Map<string, Uint8Array<ArrayBuffer>>([
      [`databases/${created.id}/b-1.dump.enc`, new Uint8Array([1])],
      ["databases/another/b-2.dump.enc", new Uint8Array([2])],
    ]);
    const store = {
      write: async () => await Promise.resolve(),
      read: async () => await Promise.resolve(new Uint8Array()),
      list: async (prefix: string) =>
        await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix))),
      delete: async (key: string) => {
        objects.delete(key);
        await Promise.resolve();
      },
    };

    await deleteDatabase({ ...dependencies, storage: { store, prefix: "" } }, created.id);

    expect([...objects.keys()]).toEqual(["databases/another/b-2.dump.enc"]);
  });

  test("removes a database that never started", async () => {
    const { created, dependencies, status } = await setup();

    await deleteDatabase({ ...dependencies, storage: null }, created.id);

    expect(status()).toBeUndefined();
  });
});
