import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { markBackupSucceeded } from "./database-backup-outcomes";
import {
  isDatabaseBackupDue,
  listDatabaseBackups,
  queueDueDatabaseBackups,
  requestDatabaseBackup,
  requestDatabaseRestore,
} from "./database-backup.service";
import { markDatabaseRunning } from "./database-provisioning.service";
import {
  DatabaseBackupInProgressError,
  DatabaseBackupNotFoundError,
  DatabaseBackupUnsupportedError,
  DatabaseNotRunningError,
} from "./database.errors";
import { createProjectDatabase, listProjectDatabases } from "./database.service";

const DAY_IN_MS = 86_400_000;

async function setup(engine: "postgres" | "redis" = "postgres") {
  const database = openMemoryDatabase();
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine, environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const queuedKinds = () =>
    database.$client
      .query<{ kind: string }, []>("SELECT kind FROM jobs WHERE kind LIKE 'database_b%'")
      .all()
      .map((row) => row.kind);
  return { database, project, created, target, queuedKinds };
}

describe("requestDatabaseBackup", () => {
  test("queues a manual backup of a running database", async () => {
    const { database, created, target, queuedKinds } = await setup();
    markDatabaseRunning(database, created.id);

    requestDatabaseBackup(database, target);

    const [backup] = listDatabaseBackups(database, target);
    expect(backup?.status).toBe("queued");
    expect(backup?.trigger).toBe("manual");
    expect(queuedKinds()).toEqual(["database_backup"]);
  });

  test("throws DatabaseBackupInProgressError while another backup is queued", async () => {
    const { database, created, target } = await setup();
    markDatabaseRunning(database, created.id);
    requestDatabaseBackup(database, target);

    expect(() => requestDatabaseBackup(database, target)).toThrow(DatabaseBackupInProgressError);
  });

  test("throws DatabaseNotRunningError for a database still starting", async () => {
    const { database, target } = await setup();

    expect(() => requestDatabaseBackup(database, target)).toThrow(DatabaseNotRunningError);
  });

  test("throws DatabaseBackupUnsupportedError for Redis", async () => {
    const { database, created, target } = await setup("redis");
    markDatabaseRunning(database, created.id);

    expect(() => requestDatabaseBackup(database, target)).toThrow(DatabaseBackupUnsupportedError);
  });
});

describe("requestDatabaseRestore", () => {
  test("marks the database restoring and queues the restore", async () => {
    const { database, project, created, target } = await setup();
    markDatabaseRunning(database, created.id);
    const backupId = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, backupId, { storageKey: "databases/x.dump.enc", sizeBytes: 10 });

    requestDatabaseRestore(database, { ...target, backupId });

    expect(listProjectDatabases(database, project.id)[0]?.status).toBe("restoring");
  });

  test("throws DatabaseBackupNotFoundError for a backup that did not succeed", async () => {
    const { database, created, target } = await setup();
    markDatabaseRunning(database, created.id);
    const backupId = requestDatabaseBackup(database, target);

    expect(() => requestDatabaseRestore(database, { ...target, backupId })).toThrow(
      DatabaseBackupNotFoundError,
    );
  });

  test("throws DatabaseNotRunningError during another restore", async () => {
    const { database, created, target } = await setup();
    markDatabaseRunning(database, created.id);
    const backupId = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, backupId, { storageKey: "databases/x.dump.enc", sizeBytes: 10 });
    requestDatabaseRestore(database, { ...target, backupId });

    expect(() => requestDatabaseRestore(database, { ...target, backupId })).toThrow(
      DatabaseNotRunningError,
    );
  });
});

describe("queueDueDatabaseBackups", () => {
  test("queues a scheduled backup for a running database without backups", async () => {
    const { database, created, target } = await setup();
    markDatabaseRunning(database, created.id);

    const queued = queueDueDatabaseBackups(database, new Date());

    expect(queued).toBe(1);
    expect(listDatabaseBackups(database, target)[0]?.trigger).toBe("scheduled");
  });

  test("skips a database backed up less than a day ago", async () => {
    const { database, created, target } = await setup();
    markDatabaseRunning(database, created.id);
    requestDatabaseBackup(database, target);

    expect(queueDueDatabaseBackups(database, new Date())).toBe(0);
  });

  test("skips databases that are not running or cannot be backed up", async () => {
    const { database } = await setup("redis");

    expect(queueDueDatabaseBackups(database, new Date())).toBe(0);
  });
});

describe("isDatabaseBackupDue", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  test("is due without any backup", () => {
    expect(isDatabaseBackupDue(null, now)).toBe(true);
  });

  test("is due once the newest backup is a day old", () => {
    expect(isDatabaseBackupDue(new Date(now.getTime() - DAY_IN_MS).toISOString(), now)).toBe(true);
  });

  test("is not due for a backup from an hour ago", () => {
    expect(isDatabaseBackupDue("2026-11-02T11:00:00Z", now)).toBe(false);
  });

  test("is due when the stored time cannot be read", () => {
    expect(isDatabaseBackupDue("not a date", now)).toBe(true);
  });
});
