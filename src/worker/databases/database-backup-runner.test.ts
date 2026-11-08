import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import type { ObjectStore } from "@/backups";
import {
  createProjectDatabase,
  DatabaseBackupInProgressError,
  listDatabaseBackups,
  listProjectDatabases,
  markBackupSucceeded,
  markDatabaseRunning,
  requestDatabaseBackup,
  requestDatabaseRestore,
} from "@/databases";
import { openMemoryDatabase, tables } from "@/db";
import type { CommandRunner } from "@/process";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runProjectCleanup } from "../container-action-runner";
import type { ServerFiles } from "../server-host";
import {
  deleteStoredDatabaseBackups,
  runDatabaseBackup,
  runDatabaseRestore,
} from "./database-backup-runner";

const DUMP = new Uint8Array([80, 71, 68, 77, 80]);

function memoryStore(): ObjectStore & { readonly objects: Map<string, Uint8Array<ArrayBuffer>> } {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    objects,
    write: async (key, data) => {
      objects.set(key, data);
      await Promise.resolve();
    },
    list: async (prefix) =>
      await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix))),
    delete: async (key) => {
      objects.delete(key);
      await Promise.resolve();
    },
    read: async (key) => {
      const data = objects.get(key);
      if (data == null) {
        throw new Error(`no object ${key}`);
      }
      return await Promise.resolve(data);
    },
  };
}

/** Server files where every read returns the dump and writes are recorded. */
function serverFiles(): ServerFiles & { readonly written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    read: async () => await Promise.resolve(new Uint8Array(DUMP)),
    write: async (path, data) => {
      written.set(path, data);
      await Promise.resolve();
    },
  };
}

const okRunner: CommandRunner = async () =>
  await Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false });

async function setup() {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  markDatabaseRunning(database, created.id);
  const docker = new FakeDocker();
  const store = memoryStore();
  const files = serverFiles();
  const dependencies = {
    database,
    docker,
    runner: okRunner,
    files,
    workspaceDir: "/var/lib/nelcota/workspaces",
    secretBox,
    storage: { store, prefix: "nelcota/" },
    logger: { warn: () => undefined },
  };
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const backups = () => listDatabaseBackups(database, target);
  return { database, project, created, docker, store, files, dependencies, target, backups };
}

describe("runDatabaseBackup", () => {
  test("stores the dump encrypted, bound to its key", async () => {
    const { database, dependencies, store, target, created } = await setup();
    const backupId = requestDatabaseBackup(database, target);

    await runDatabaseBackup(dependencies, backupId);

    const key = `nelcota/databases/${created.id}/${backupId}.dump.enc`;
    const stored = store.objects.get(key);
    expect(stored).toBeDefined();
    expect(stored).not.toEqual(DUMP);
    const decrypted = await dependencies.secretBox.decryptBytes(stored ?? new Uint8Array(), key);
    expect([...decrypted]).toEqual([...DUMP]);
  });

  test("records the size of a successful backup", async () => {
    const { database, dependencies, target, backups } = await setup();
    const backupId = requestDatabaseBackup(database, target);

    await runDatabaseBackup(dependencies, backupId);

    expect(backups()[0]?.status).toBe("succeeded");
    expect(backups()[0]?.sizeBytes).toBe(DUMP.byteLength);
  });

  test("dumps inside the container and removes the dump afterwards", async () => {
    const { database, dependencies, docker, target } = await setup();
    const backupId = requestDatabaseBackup(database, target);

    await runDatabaseBackup(dependencies, backupId);

    expect(docker.calls.some((call) => call.includes("pg_dump"))).toBe(true);
    expect(docker.calls.some((call) => call.includes(`rm -f /tmp/nelcota-${backupId}-`))).toBe(
      true,
    );
  });

  test("keeps only the newest seven successful backups", async () => {
    const { database, dependencies, store, target, backups } = await setup();
    const runOne = async () => {
      const backupId = requestDatabaseBackup(database, target);
      await runDatabaseBackup(dependencies, backupId);
    };
    for (const _ of Array.from({ length: 8 })) {
      // Each backup must finish before the next can be requested.
      await runOne();
    }

    expect(backups()).toHaveLength(7);
    expect(store.objects.size).toBe(7);
  });

  test("records why a backup failed", async () => {
    const { database, dependencies, docker, target, backups } = await setup();
    docker.execFailure = "pg_dump: error: connection failed";
    const backupId = requestDatabaseBackup(database, target);

    const error = await runDatabaseBackup(dependencies, backupId).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(backups()[0]?.status).toBe("failed");
    expect(backups()[0]?.errorMessage).toContain("connection failed");
  });

  test("blocks restoration of an old backup while retention is deleting it", async () => {
    const { database, dependencies, store, target, backups } = await setup();
    for (const _ of Array.from({ length: 7 })) {
      const id = requestDatabaseBackup(database, target);
      await runDatabaseBackup(dependencies, id);
    }
    const oldest = backups().at(-1);
    if (oldest == null) {
      throw new Error("Expected an old backup to restore");
    }
    const restoreFailures: unknown[] = [];
    const guardedStorage = {
      ...dependencies.storage,
      store: {
        ...store,
        delete: async (key: string) => {
          try {
            requestDatabaseRestore(database, { ...target, backupId: oldest.id });
          } catch (error) {
            restoreFailures.push(error);
          }
          await store.delete(key);
        },
      },
    };
    const backupId = requestDatabaseBackup(database, target);

    await runDatabaseBackup({ ...dependencies, storage: guardedStorage }, backupId);

    expect(restoreFailures).toHaveLength(1);
    expect(restoreFailures.at(0)).toBeInstanceOf(DatabaseBackupInProgressError);
  });
});

describe("runDatabaseRestore", () => {
  async function restorable() {
    const context = await setup();
    const backupId = requestDatabaseBackup(context.database, context.target);
    await runDatabaseBackup(context.dependencies, backupId);
    requestDatabaseRestore(context.database, { ...context.target, backupId });
    return { ...context, backupId };
  }

  test("loads the decrypted dump into the container with pg_restore", async () => {
    const { dependencies, docker, files, backupId } = await restorable();

    await runDatabaseRestore(dependencies, backupId);

    expect([...(files.written.values().next().value ?? [])]).toEqual([...DUMP]);
    expect(docker.calls.some((call) => call.includes("pg_restore"))).toBe(true);
  });

  test("puts the database back to running and records the restore", async () => {
    const { database, project, dependencies, backups, backupId } = await restorable();

    await runDatabaseRestore(dependencies, backupId);

    expect(listProjectDatabases(database, project.id)[0]?.status).toBe("running");
    expect(backups()[0]?.restoredAt).not.toBeNull();
  });

  test("records why a restore failed and keeps the database running", async () => {
    const { database, project, dependencies, docker, backups, backupId } = await restorable();
    docker.execFailure = "pg_restore: error: could not execute query";

    const error = await runDatabaseRestore(dependencies, backupId).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(backups()[0]?.restoreError).toContain("could not execute query");
    expect(listProjectDatabases(database, project.id)[0]?.status).toBe("running");
  });

  test("fails before pg_restore when the stored dump is missing", async () => {
    const { database, dependencies, docker, target } = await setup();
    const backupId = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, backupId, { storageKey: "missing", sizeBytes: 1 });
    const callsBefore = docker.calls.length;

    const error = await runDatabaseRestore(dependencies, backupId).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(docker.calls.slice(callsBefore).some((call) => call.includes("pg_restore"))).toBe(false);
  });
});

test("reports a missing backup instead of silently succeeding", async () => {
  const { database, dependencies } = await setup();
  using _connection = database.$client;

  const failure = await runDatabaseRestore(dependencies, "missing-backup").catch(
    (error: unknown) => error,
  );

  expect(failure).toMatchObject({ message: "Backup missing-backup no longer exists" });
});

test("records a missing storage key and releases the database from restoring", async () => {
  const { database, dependencies, target, project, backups } = await setup();
  using _connection = database.$client;
  const backupId = requestDatabaseBackup(database, target);
  database
    .update(tables.databaseBackups)
    .set({ status: "succeeded" })
    .where(eq(tables.databaseBackups.id, backupId))
    .run();
  requestDatabaseRestore(database, { ...target, backupId });

  const failure = await runDatabaseRestore(dependencies, backupId).catch((error: unknown) => error);

  expect(failure).toMatchObject({ message: `Backup ${backupId} has no stored dump` });

  expect(listProjectDatabases(database, project.id)[0]?.status).toBe("running");
  expect(backups()[0]?.restoreError).toContain("no stored dump");
});

test("bounds concurrent storage deletions even when many old dumps remain", async () => {
  const store = memoryStore();
  const prefix = "nelcota/databases/database/";
  for (const index of Array.from({ length: 27 }, (_, value) => value)) {
    store.objects.set(`${prefix}${index}.dump.enc`, DUMP);
  }
  const state = { running: 0, maximum: 0 };
  const boundedStore: ObjectStore = {
    ...store,
    delete: async (key) => {
      state.running += 1;
      state.maximum = Math.max(state.maximum, state.running);
      await store.delete(key);
      state.running -= 1;
    },
  };

  await deleteStoredDatabaseBackups({ store: boundedStore, prefix: "nelcota/" }, "database");

  expect(store.objects.size).toBe(0);
  expect(state.maximum).toBeLessThanOrEqual(10);
});

test("deletes stored dumps before deleting a project's backup records", async () => {
  const { database, project, created, dependencies, store, target } = await setup();
  using _connection = database.$client;
  const backupId = requestDatabaseBackup(database, target);
  await runDatabaseBackup(dependencies, backupId);
  store.objects.set(`nelcota/databases/${created.id}/orphan.dump.enc`, DUMP);
  store.objects.set("nelcota/databases/another-project/keep.dump.enc", DUMP);

  await runProjectCleanup(database, [{ docker: dependencies.docker, routes: null }], {
    projectId: project.id,
    storage: dependencies.storage,
  });

  expect([...store.objects.keys()]).toEqual(["nelcota/databases/another-project/keep.dump.enc"]);
  expect(database.select().from(tables.databaseBackups).all()).toEqual([]);
});

test("preserves backup metadata when storage cleanup fails and succeeds on retry", async () => {
  const { database, project, dependencies, store, target } = await setup();
  using _connection = database.$client;
  const backupId = requestDatabaseBackup(database, target);
  await runDatabaseBackup(dependencies, backupId);
  const storage = {
    ...dependencies.storage,
    store: { ...store, delete: () => Promise.reject(new Error("Storage unavailable")) },
  };

  const failure = await runProjectCleanup(database, [], { projectId: project.id, storage }).catch(
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ message: "Storage unavailable" });
  expect(
    database.select({ id: tables.databaseBackups.id }).from(tables.databaseBackups).all(),
  ).toEqual([{ id: backupId }]);
  expect(store.objects.size).toBe(1);

  await runProjectCleanup(database, [], { projectId: project.id, storage: dependencies.storage });

  expect(store.objects.size).toBe(0);
  expect(database.select({ id: tables.projects.id }).from(tables.projects).all()).toEqual([]);
});
