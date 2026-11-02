import { expect, test } from "bun:test";

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
  retryDatabaseProvision,
} from "@/databases";
import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { claimNextJob, completeJob, failJob, releaseWorkerJobs } from "@/jobs";
import { createLogger } from "@/logging";
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
