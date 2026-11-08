import { expect, test } from "bun:test";

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
import {
  assertJobOwnership,
  claimNextJob,
  completeJob,
  JobLeaseLostError,
  releaseWorkerJobs,
} from "@/jobs";
import { createLogger } from "@/logging";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { handleRecoveredJobs } from "../job-recovery";
import { type DatabaseBackupDependencies, runDatabaseRestore } from "./database-backup-runner";

async function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const secretBox = await createTestSecretBox();
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const provision = claimNextJob(database, "setup");
  if (provision == null) {
    throw new Error("Expected a provision job");
  }
  completeJob(database, provision);
  markDatabaseRunning(database, created.id);
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const backupId = requestDatabaseBackup(database, target);
  markBackupSucceeded(database, backupId, { storageKey: "dump", sizeBytes: 5 });
  const backup = claimNextJob(database, "setup");
  if (backup == null) {
    throw new Error("Expected a backup job");
  }
  completeJob(database, backup);
  requestDatabaseRestore(database, { ...target, backupId });
  const job = claimNextJob(database, "old-worker");
  if (job == null) {
    throw new Error("Expected a restore job");
  }
  const controller = new AbortController();
  const docker = new FakeDocker();
  const encrypted = await secretBox.encryptBytes(new Uint8Array([80, 71, 68, 77, 80]), "dump");
  const dependencies: DatabaseBackupDependencies = {
    database,
    secretBox,
    docker,
    workspaceDir: "/review",
    signal: controller.signal,
    assertOwnership: () => assertJobOwnership(database, job),
    runner: async () =>
      await Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: false,
      }),
    files: {
      read: async () => await Promise.resolve(new Uint8Array()),
      write: async () => await Promise.resolve(),
    },
    storage: {
      prefix: "",
      store: {
        read: async () => await Promise.resolve(encrypted),
        write: async () => await Promise.resolve(),
        delete: async () => await Promise.resolve(),
        list: async () => await Promise.resolve([]),
      },
    },
    logger: { warn: () => undefined },
  };
  const replaceAttempt = () => {
    handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "old-worker"));
    controller.abort(new JobLeaseLostError(job.id));
    requestDatabaseRestore(database, { ...target, backupId });
    const replacement = claimNextJob(database, "replacement");
    if (replacement == null) {
      throw new Error("Expected a replacement restore job");
    }
    return replacement;
  };
  return { database, project, target, backupId, controller, docker, dependencies, replaceAttempt };
}

test("does not reset the database after losing its lease during download", async () => {
  const context = await setup();
  using _connection = context.database.$client;
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const store = context.dependencies.storage.store;
  const dependencies = {
    ...context.dependencies,
    storage: {
      prefix: "",
      store: {
        ...store,
        read: async (key: string) => {
          started.resolve();
          await gate.promise;
          return await store.read(key);
        },
      },
    },
  };

  const execution = runDatabaseRestore(dependencies, context.backupId).catch(
    (error: unknown) => error,
  );
  await started.promise;
  const replacement = context.replaceAttempt();
  gate.resolve();
  const failure = await execution;

  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect(
    context.docker.calls.some((call) => call.includes("dropdb") || call.includes("pg_restore")),
  ).toBe(false);
  expect(listProjectDatabases(context.database, context.project.id).at(0)?.status).toBe(
    "restoring",
  );
  expect(listDatabaseBackups(context.database, context.target).at(0)?.restoredAt).toBeNull();
  expect(() => assertJobOwnership(context.database, replacement)).not.toThrow();
});

test("cancels the restore command without overwriting a replacement attempt's state", async () => {
  const context = await setup();
  using _connection = context.database.$client;
  const exec = context.docker.execInContainer.bind(context.docker);
  context.docker.execInContainer = async (reference, command, options) => {
    if (command[0] === "pg_restore" && command.includes("--single-transaction")) {
      expect(options.signal).toBe(context.controller.signal);
      context.replaceAttempt();
      expect(options.signal?.aborted).toBe(true);
      return await Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
      });
    }
    return await exec(reference, command, options);
  };

  const failure = await runDatabaseRestore(context.dependencies, context.backupId).catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect(listProjectDatabases(context.database, context.project.id).at(0)?.status).toBe(
    "restoring",
  );
  expect(listDatabaseBackups(context.database, context.target).at(0)?.restoreError).toContain(
    "worker stopped",
  );
});

test("does not record success after losing its lease during cleanup", async () => {
  const context = await setup();
  using _connection = context.database.$client;
  const exec = context.docker.execInContainer.bind(context.docker);
  context.docker.execInContainer = async (reference, command, options) => {
    if (command[0] === "rm") {
      context.replaceAttempt();
    }
    return await exec(reference, command, options);
  };

  const failure = await runDatabaseRestore(context.dependencies, context.backupId).catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect(listProjectDatabases(context.database, context.project.id).at(0)?.status).toBe(
    "restoring",
  );
  expect(listDatabaseBackups(context.database, context.target).at(0)?.restoredAt).toBeNull();
});

test("does not drop the database when archive validation fails", async () => {
  const context = await setup();
  using _connection = context.database.$client;
  context.docker.execFailure = "pg_restore: invalid archive";

  const failure = await runDatabaseRestore(context.dependencies, context.backupId).catch(
    (error: unknown) => error,
  );

  expect(failure).toMatchObject({ message: "pg_restore failed: pg_restore: invalid archive" });

  expect(
    context.docker.calls.some((call) => call.includes("dropdb") && call.endsWith(" app")),
  ).toBe(false);
  expect(listProjectDatabases(context.database, context.project.id).at(0)?.status).toBe("running");
});
