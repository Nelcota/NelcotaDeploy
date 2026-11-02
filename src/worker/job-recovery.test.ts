import { describe, expect, test } from "bun:test";

import {
  createProjectDatabase,
  listDatabaseBackups,
  listProjectDatabases,
  markBackupRunning,
  markBackupSucceeded,
  markDatabaseRunning,
  requestDatabaseBackup,
  requestDatabaseDeletion,
  requestDatabaseRestore,
  recoverDatabaseJob,
  retryDatabaseProvision,
} from "@/databases";
import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { claimNextJob, completeJob, releaseWorkerJobs } from "@/jobs";
import { createLogger } from "@/logging";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { handleRecoveredJobs } from "./job-recovery";

test("marks an interrupted queued deployment failed when its retry allowance is exhausted", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const deploymentId = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;

  handleRecoveredJobs(database, createLogger("test"), [
    {
      id: "job",
      kind: "deploy",
      payload: {},
      deploymentId,
      taskExecutionId: null,
      outcome: "failed",
    },
  ]);

  expect(getDeployment(database, deploymentId).status).toBe("failed");
});

async function setupDatabaseOperation() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const claim = () => {
    const job = claimNextJob(database, "recovery-test");
    if (job == null) {
      throw new Error("Expected a database operation in the queue");
    }
    return job;
  };
  const finishProvision = () => {
    completeJob(database, claim().id);
    markDatabaseRunning(database, created.id);
  };
  const recover = (now?: Date) =>
    handleRecoveredJobs(
      database,
      createLogger("test"),
      releaseWorkerJobs(database, "recovery-test", now),
    );
  return { database, project, created, target, claim, finishProvision, recover };
}

describe("interrupted database jobs", () => {
  test("marks provisioning failed and lets the user retry after a worker restart", async () => {
    const { database, project, created, target, claim, recover } = await setupDatabaseOperation();
    claim();

    recover();

    expect(listProjectDatabases(database, project.id).at(0)?.status).toBe("failed");
    retryDatabaseProvision(database, target);
    expect(listProjectDatabases(database, project.id).at(0)?.status).toBe("provisioning");
    expect(claim().payload["databaseId"]).toBe(created.id);
  });

  test("clears interrupted deletion so it can be requested again", async () => {
    const { database, project, target, claim, finishProvision, recover } =
      await setupDatabaseOperation();
    finishProvision();
    requestDatabaseDeletion(database, target);
    claim();

    recover();

    expect(listProjectDatabases(database, project.id).at(0)?.deletionRequestedAt).toBeNull();
    expect(listProjectDatabases(database, project.id).at(0)?.errorMessage).toContain(
      "worker stopped",
    );
    requestDatabaseDeletion(database, target);
    expect(claim().kind).toBe("database_delete");
  });

  test("fails an interrupted backup and permits a new manual backup", async () => {
    const { database, target, claim, finishProvision, recover } = await setupDatabaseOperation();
    finishProvision();
    const backupId = requestDatabaseBackup(database, target);
    claim();
    markBackupRunning(database, backupId);

    recover();

    expect(listDatabaseBackups(database, target).at(0)?.status).toBe("failed");
    expect(requestDatabaseBackup(database, target)).toBeString();
  });

  test("records an interrupted restore and permits another restore", async () => {
    const { database, project, target, claim, finishProvision, recover } =
      await setupDatabaseOperation();
    finishProvision();
    const backupId = requestDatabaseBackup(database, target);
    completeJob(database, claim().id);
    markBackupSucceeded(database, backupId, { storageKey: "test.dump.enc", sizeBytes: 10 });
    requestDatabaseRestore(database, { ...target, backupId });
    claim();

    recover();

    expect(listProjectDatabases(database, project.id).at(0)?.status).toBe("running");
    expect(listDatabaseBackups(database, target).at(0)?.restoreError).toContain("worker stopped");
    requestDatabaseRestore(database, { ...target, backupId });
    expect(claim().kind).toBe("database_restore");
  });

  test("preserves a backup completed just before the worker stopped", async () => {
    const { database, target, claim, finishProvision, recover } = await setupDatabaseOperation();
    finishProvision();
    const backupId = requestDatabaseBackup(database, target);
    claim();
    markBackupSucceeded(database, backupId, { storageKey: "test.dump.enc", sizeBytes: 10 });

    recover();

    expect(listDatabaseBackups(database, target).at(0)?.status).toBe("succeeded");
  });

  test("keeps a retriable backup running until its requeued job resumes", async () => {
    const { database, target, claim, finishProvision, recover } = await setupDatabaseOperation();
    finishProvision();
    const backupId = requestDatabaseBackup(database, target);
    const job = claim();
    database.$client.run("UPDATE jobs SET max_attempts = 2 WHERE id = ?", [job.id]);
    markBackupRunning(database, backupId);

    recover(new Date("2026-11-02T12:00:00Z"));

    expect(listDatabaseBackups(database, target).at(0)?.status).toBe("running");
    const retried = claimNextJob(database, "recovery-test", new Date("2026-11-02T12:01:00Z"));
    expect(retried?.payload["backupId"]).toBe(backupId);
  });
});

test.each([undefined, null, "", "  ", 0])(
  "rejects a recovered database job with invalid target %p",
  (databaseId) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const job = {
      id: "invalid",
      kind: "database_provision",
      payload: { databaseId },
      deploymentId: null,
      taskExecutionId: null,
      outcome: "failed",
    } as const;

    expect(() => recoverDatabaseJob(database, job)).toThrow("missing its databaseId");
  },
);
