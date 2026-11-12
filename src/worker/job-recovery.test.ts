import { describe, expect, test } from "bun:test";

import {
  createProjectDatabase,
  findDatabaseBackup,
  listDatabaseBackups,
  listProjectDatabases,
  markDatabaseRunning,
  markBackupSucceeded,
  requestDatabaseBackup,
  requestDatabaseRestore,
  requestDatabaseDeletion,
  markBackupRunning,
  recoverDatabaseJob,
  retryDatabaseProvision,
} from "@/databases";
import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { claimNextJob, completeJob, failJob, releaseWorkerJobs } from "@/jobs";
import { createLogger } from "@/logging";
import { closePreview, openPreview } from "@/previews";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";
import {
  addProjectVolume,
  listProjectVolumes,
  requestVolumeDeletion,
  setVolumeAttached,
} from "@/volumes";

import { handleRecoveredJobs } from "./job-recovery";
import { recoverFailedResources } from "./maintenance/resource-recovery";

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
      deploymentId,
      taskExecutionId: null,
      payload: {},
      outcome: "failed",
    },
  ]);

  expect(getDeployment(database, deploymentId).status).toBe("failed");
});

test("cancels the recovered attempt of a preview that closed while its job was claimed", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const target = { projectId: project.id, number: 12, branch: "feature", headSha: "a".repeat(40) };
  const previewId = openPreview(database, target);
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
    previewId,
  });
  expect(claimNextJob(database, "interrupted")?.deploymentId).toBe(deploymentId);
  closePreview(database, target);

  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));

  expect(getDeployment(database, deploymentId).status).toBe("cancelled");
  expect(claimNextJob(database, "replacement")?.kind).toBe("preview_cleanup");
});

test("makes an interrupted database provisioning retryable from its failed state", async () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  claimNextJob(database, "interrupted");
  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));
  expect(listProjectDatabases(database, project.id).at(0)?.status).toBe("failed");
  retryDatabaseProvision(database, {
    projectId: project.id,
    databaseId: created.id,
    actor: TEST_ACTOR,
  });
  expect(claimNextJob(database, "replacement")?.kind).toBe("database_provision");
});

test("repairs a previously stranded database once, without touching a newer retry", async () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const job = claimNextJob(database, "old-worker");
  if (job == null) {
    throw new Error("Expected a database job");
  }
  failJob(database, job, { errorMessage: "Worker stopped", retryable: false });
  expect(recoverFailedResources(database, createLogger("test"))).toBe(1);
  expect(recoverFailedResources(database, createLogger("test"))).toBe(0);
  retryDatabaseProvision(database, {
    projectId: project.id,
    databaseId: created.id,
    actor: TEST_ACTOR,
  });
  expect(recoverFailedResources(database, createLogger("test"))).toBe(0);
  expect(listProjectDatabases(database, project.id).at(0)?.status).toBe("provisioning");
});

test("unblocks deletion after the worker stopped while deleting a database", async () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const provision = claimNextJob(database, "worker");
  if (provision == null) {
    throw new Error("Expected a provisioning job");
  }
  completeJob(database, provision);
  markDatabaseRunning(database, created.id);
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  requestDatabaseDeletion(database, target);
  claimNextJob(database, "interrupted");
  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));
  expect(listProjectDatabases(database, project.id).at(0)?.deletionRequestedAt).toBeNull();
  expect(() => requestDatabaseDeletion(database, target)).not.toThrow();
});

test("unblocks a volume deletion interrupted by a worker crash", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const volume = addProjectVolume(database, {
    projectId: project.id,
    input: { mountPath: "/data" },
    actor: TEST_ACTOR,
  });
  const target = { projectId: project.id, volumeId: volume.id, actor: TEST_ACTOR };
  setVolumeAttached(database, { ...target, attached: false });
  requestVolumeDeletion(database, target);
  claimNextJob(database, "interrupted");
  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));
  const stored = listProjectVolumes(database, project.id).at(0);
  expect(stored?.deletionRequestedAt).toBeNull();
  expect(stored?.deletionError).toContain("worker stopped");
  expect(() => requestVolumeDeletion(database, target)).not.toThrow();
});

async function backupFixture() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const created = await createProjectDatabase(database, await createTestSecretBox(), {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const provision = claimNextJob(database, "worker");
  if (provision == null) {
    throw new Error("Expected a provisioning job");
  }
  completeJob(database, provision);
  markDatabaseRunning(database, created.id);
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const backupId = requestDatabaseBackup(database, target);
  return { database, target, backupId };
}

test("an interrupted backup becomes failed and can be requested again", async () => {
  const { database, target, backupId } = await backupFixture();
  claimNextJob(database, "interrupted");
  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));
  expect(findDatabaseBackup(database, backupId)?.status).toBe("failed");
  expect(() => requestDatabaseBackup(database, target)).not.toThrow();
});

test("an interrupted restore records the failure and releases the restoring state", async () => {
  const { database, target, backupId } = await backupFixture();
  const backupJob = claimNextJob(database, "worker");
  if (backupJob == null) {
    throw new Error("Expected a backup job");
  }
  markBackupSucceeded(database, backupId, { storageKey: "backup.dump.enc", sizeBytes: 100 });
  completeJob(database, backupJob);
  requestDatabaseRestore(database, { ...target, backupId });
  claimNextJob(database, "interrupted");
  handleRecoveredJobs(database, createLogger("test"), releaseWorkerJobs(database, "interrupted"));
  expect(listProjectDatabases(database, target.projectId).at(0)?.status).toBe("running");
  expect(listDatabaseBackups(database, target).at(0)?.restoreError).toContain("worker stopped");
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
    completeJob(database, claim());
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
    completeJob(database, claim());
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
