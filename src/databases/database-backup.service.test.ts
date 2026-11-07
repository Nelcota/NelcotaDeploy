import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob, completeJob } from "@/jobs";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import {
  finishBackupRestore,
  listExpiredDatabaseBackups,
  markBackupSucceeded,
} from "./database-backup-outcomes";
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
  test.each([null, "previous restore failed"])(
    "refuses a second restore until the previous job finishes, outcome=%p",
    async (failure) => {
      const { database, created, target } = await setup();
      using _connection = database.$client;
      const provision = claimNextJob(database, "setup");
      if (provision == null) {
        throw new Error("Expected a provision job");
      }
      completeJob(database, provision);
      markDatabaseRunning(database, created.id);
      const makeBackup = () => {
        const id = requestDatabaseBackup(database, target);
        markBackupSucceeded(database, id, { storageKey: `${id}.enc`, sizeBytes: 5 });
        const job = claimNextJob(database, "setup");
        if (job == null) {
          throw new Error("Expected a backup job");
        }
        completeJob(database, job);
        return id;
      };
      const first = makeBackup();
      const second = makeBackup();
      requestDatabaseRestore(database, { ...target, backupId: first });
      const job = claimNextJob(database, "restoring");
      if (job == null) {
        throw new Error("Expected a restore job");
      }
      finishBackupRestore(database, { id: first, databaseId: created.id }, failure);

      expect(() => requestDatabaseRestore(database, { ...target, backupId: first })).toThrow(
        DatabaseNotRunningError,
      );
      expect(() => requestDatabaseRestore(database, { ...target, backupId: second })).toThrow(
        DatabaseNotRunningError,
      );
      expect(listProjectDatabases(database, target.projectId).at(0)?.status).toBe("running");
      completeJob(database, job);
      requestDatabaseRestore(database, { ...target, backupId: second });

      expect(claimNextJob(database, "next")?.payload["backupId"]).toBe(second);
      expect(
        listDatabaseBackups(database, target).find((backup) => backup.id === second)
          ?.restorePending,
      ).toBe(true);
    },
  );
  test.each([null, "pg_restore failed"])(
    "refreshes a pending restore until its job records outcome %p",
    async (failure) => {
      const { database, created, target } = await setup();
      using _connection = database.$client;
      markDatabaseRunning(database, created.id);
      const backupId = requestDatabaseBackup(database, target);
      markBackupSucceeded(database, backupId, { storageKey: "dump.enc", sizeBytes: 5 });
      for (const _kind of ["database_provision", "database_backup"]) {
        const job = claimNextJob(database, "setup");
        if (job == null) {
          throw new Error("Expected a setup job");
        }
        completeJob(database, job);
      }

      requestDatabaseRestore(database, { ...target, backupId });
      expect(listDatabaseBackups(database, target).at(0)?.restorePending).toBe(true);
      const job = claimNextJob(database, "restore");
      if (job == null) {
        throw new Error("Expected a restore job");
      }
      expect(listDatabaseBackups(database, target).at(0)?.restorePending).toBe(true);
      finishBackupRestore(database, { id: backupId, databaseId: created.id }, failure);
      expect(listDatabaseBackups(database, target).at(0)?.restorePending).toBe(true);
      completeJob(database, job);

      const backup = listDatabaseBackups(database, target).at(0);
      expect(backup?.restorePending).toBe(false);
      expect(backup?.restoreError).toBe(failure);
      expect(backup?.restoredAt != null).toBe(failure == null);
    },
  );
  test.each(["queued", "running"] as const)(
    "refuses a restore while another backup is %s",
    async (status) => {
      const { database, created, target } = await setup();
      using _connection = database.$client;
      markDatabaseRunning(database, created.id);
      const backupId = requestDatabaseBackup(database, target);
      markBackupSucceeded(database, backupId, { storageKey: "old.dump.enc", sizeBytes: 1 });
      const pending = requestDatabaseBackup(database, target);
      database
        .update(tables.databaseBackups)
        .set({ status })
        .where(eq(tables.databaseBackups.id, pending))
        .run();

      expect(() => requestDatabaseRestore(database, { ...target, backupId })).toThrow(
        DatabaseBackupInProgressError,
      );
      expect(listProjectDatabases(database, target.projectId)[0]?.status).toBe("running");
    },
  );

  test("refuses a restore while a successful backup's job is still pruning", async () => {
    const { database, created, target } = await setup();
    using _connection = database.$client;
    markDatabaseRunning(database, created.id);
    const backupId = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, backupId, { storageKey: "dump.enc", sizeBytes: 1 });
    database
      .update(tables.jobs)
      .set({ status: "running" })
      .where(eq(tables.jobs.dedupeKey, `database-backup:${backupId}`))
      .run();

    expect(() => requestDatabaseRestore(database, { ...target, backupId })).toThrow(
      DatabaseBackupInProgressError,
    );
  });

  test("keeps an expired dump while it is the target of a queued restore", async () => {
    const { database, created, target } = await setup();
    using _connection = database.$client;
    markDatabaseRunning(database, created.id);
    const oldest = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, oldest, { storageKey: "old.dump.enc", sizeBytes: 1 });
    database
      .update(tables.databaseBackups)
      .set({ createdAt: "2026-01-01T00:00:00Z" })
      .where(eq(tables.databaseBackups.id, oldest))
      .run();
    const latest = requestDatabaseBackup(database, target);
    markBackupSucceeded(database, latest, { storageKey: "latest.dump.enc", sizeBytes: 1 });
    expect(listExpiredDatabaseBackups(database, created.id, 1).map((backup) => backup.id)).toEqual([
      oldest,
    ]);

    requestDatabaseRestore(database, { ...target, backupId: oldest });

    expect(listExpiredDatabaseBackups(database, created.id, 1)).toEqual([]);
  });

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
  test("does not enqueue a daily backup while the database is restoring", async () => {
    const { database, created } = await setup();
    using _connection = database.$client;
    database
      .update(tables.projectDatabases)
      .set({ status: "restoring" })
      .where(eq(tables.projectDatabases.id, created.id))
      .run();

    expect(queueDueDatabaseBackups(database, new Date("2026-11-02T12:00:00Z"))).toBe(0);
  });

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
