import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { localObjectStore } from "@/backups";
import {
  createProjectDatabase,
  databaseBackupKey,
  findDatabaseBackup,
  markBackupSucceeded,
  markDatabaseRunning,
  requestDatabaseBackup,
} from "@/databases";
import { openMemoryDatabase } from "@/db";
import { getProject } from "@/projects";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runProjectCleanup } from "../container-action-runner";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-project-backups-"));
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  markDatabaseRunning(database, created.id);
  const backupId = requestDatabaseBackup(database, {
    projectId: project.id,
    databaseId: created.id,
    actor: TEST_ACTOR,
  });
  const storage = { store: localObjectStore(directory), prefix: "nelcota/" };
  const key = databaseBackupKey(storage.prefix, { id: backupId, databaseId: created.id });
  await storage.store.write(key, new Uint8Array([1]));
  markBackupSucceeded(database, backupId, { storageKey: key, sizeBytes: 1 });
  return {
    database,
    project,
    backupId,
    key,
    storage,
    [Symbol.asyncDispose]: async () => {
      database.$client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("runProjectCleanup database backups", () => {
  test("deletes stored backups and orphan dumps without touching another database", async () => {
    await using context = await setup();
    const { database, project, backupId, key, storage } = context;
    const orphanKey = key.replace(backupId, "orphan");
    const otherKey = "nelcota/databases/another/backup.dump.enc";
    await storage.store.write(orphanKey, new Uint8Array([2]));
    await storage.store.write(otherKey, new Uint8Array([3]));

    await runProjectCleanup(database, [{ docker: new FakeDocker(), routes: null }], {
      projectId: project.id,
      storage,
    });

    expect(await storage.store.list(storage.prefix)).toEqual([otherKey]);
    expect(findDatabaseBackup(database, backupId)).toBeNull();
  });

  test("preserves project and backup metadata when storage deletion fails", async () => {
    await using context = await setup();
    const { database, project, backupId, key, storage } = context;
    const failingStorage = {
      ...storage,
      store: {
        ...storage.store,
        delete: async () => await Promise.reject(new Error("Storage unavailable")),
      },
    };

    const error = await runProjectCleanup(database, [], {
      projectId: project.id,
      storage: failingStorage,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain("Storage unavailable");
    expect(getProject(database, project.id).id).toBe(project.id);
    expect(findDatabaseBackup(database, backupId)?.storageKey).toBe(key);
    expect(await storage.store.list(storage.prefix)).toEqual([key]);
  });

  test("preserves backup metadata when storage is no longer configured", async () => {
    await using context = await setup();
    const { database, project, backupId } = context;

    const error = await runProjectCleanup(database, [], {
      projectId: project.id,
      storage: null,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain("without backup storage");
    expect(findDatabaseBackup(database, backupId)).not.toBeNull();
  });

  test("deletes a project without databases when storage is unconfigured", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const project = createTestProject(database);

    const result = await runProjectCleanup(database, [], { projectId: project.id, storage: null });

    expect(result.failures).toEqual([]);
    expect(() => getProject(database, project.id)).toThrow();
  });
});
