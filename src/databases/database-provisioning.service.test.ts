import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  failDatabaseDeletion,
  finishDatabaseDeletion,
  listRunningDatabases,
  markDatabaseFailed,
  markDatabaseRunning,
} from "./database-provisioning.service";
import {
  createProjectDatabase,
  listProjectDatabases,
  requestDatabaseDeletion,
} from "./database.service";

async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const requestDeletion = () =>
    requestDatabaseDeletion(database, {
      projectId: project.id,
      databaseId: created.id,
      actor: TEST_ACTOR,
    });
  const current = () => listProjectDatabases(database, project.id)[0];
  return { database, created, requestDeletion, current };
}

describe("database outcomes recorded by the worker", () => {
  test("marks a database running once it accepts connections", async () => {
    const { database, created, current } = await setup();

    markDatabaseRunning(database, created.id);

    expect(current()?.status).toBe("running");
  });

  test("keeps the reason of a failed provisioning", async () => {
    const { database, created, current } = await setup();

    markDatabaseFailed(database, created.id, "image not found");

    expect(current()?.status).toBe("failed");
    expect(current()?.errorMessage).toBe("image not found");
  });

  test("removes the database once its deletion finished", async () => {
    const { database, created, requestDeletion, current } = await setup();
    requestDeletion();

    finishDatabaseDeletion(database, created.id);

    expect(current()).toBeUndefined();
  });

  test("lets the user retry a deletion that failed", async () => {
    const { database, created, requestDeletion, current } = await setup();
    requestDeletion();

    failDatabaseDeletion(database, created.id, "volume in use");

    expect(current()?.deletionRequestedAt).toBeNull();
    expect(current()?.errorMessage).toBe("volume in use");
  });
});

describe("listRunningDatabases", () => {
  test("lists a running database with its project's server", async () => {
    const { database, created } = await setup();
    markDatabaseRunning(database, created.id);

    const [running] = listRunningDatabases(database);

    expect(running?.id).toBe(created.id);
    expect(running?.projectName).toBe("API");
    expect(running?.serverId).toBe("local");
  });

  test("leaves out databases still starting", async () => {
    const { database } = await setup();

    expect(listRunningDatabases(database)).toEqual([]);
  });

  test("leaves out databases being deleted", async () => {
    const { database, created, requestDeletion } = await setup();
    markDatabaseRunning(database, created.id);
    requestDeletion();

    expect(listRunningDatabases(database)).toEqual([]);
  });
});
