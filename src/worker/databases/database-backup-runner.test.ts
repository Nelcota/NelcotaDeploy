import { describe, expect, test } from "bun:test";

import type { ObjectStore } from "@/backups";
import {
  createProjectDatabase,
  listDatabaseBackups,
  listProjectDatabases,
  markBackupSucceeded,
  markDatabaseRunning,
  requestDatabaseBackup,
  requestDatabaseRestore,
} from "@/databases";
import { openMemoryDatabase } from "@/db";
import type { CommandRunner } from "@/process";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import type { ServerFiles } from "../server-host";
import { runDatabaseBackup, runDatabaseRestore } from "./database-backup-runner";

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
    expect(docker.calls.some((call) => call.includes(`rm -f /tmp/nelcota-${backupId}.dump`))).toBe(
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
