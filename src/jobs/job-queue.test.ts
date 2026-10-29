import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase, tables } from "@/db";

import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  JOB_LEASE_IN_MS,
  recoverExpiredJobs,
} from "./job-queue";

function insertProject(database: Database, slug: string): string {
  const id = Bun.randomUUIDv7();
  const now = new Date().toISOString();
  database
    .insert(tables.projects)
    .values({
      id,
      name: slug,
      slug,
      repositoryUrl: `https://github.com/acme/${slug}`,
      repositoryFullName: `acme/${slug}`,
      branch: "main",
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      internalPort: 3000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

const T0 = new Date("2026-10-28T12:00:00.000Z");

describe("job queue", () => {
  test("claims the oldest queued job and marks it running", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    const first = enqueueJob(database, { kind: "deploy", projectId }, T0);
    enqueueJob(
      database,
      { kind: "deploy", projectId: insertProject(database, "web") },
      new Date(T0.getTime() + 1),
    );

    const claimed = claimNextJob(database, "worker-1", T0);

    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  test("never claims a second job of a project that already has a running job", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    enqueueJob(database, { kind: "deploy", projectId }, T0);
    enqueueJob(database, { kind: "container_action", projectId }, T0);
    claimNextJob(database, "worker-1", T0);

    const second = claimNextJob(database, "worker-2", T0);

    expect(second).toBeNull();
  });

  test("the database rejects two running jobs for the same project", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    enqueueJob(database, { kind: "deploy", projectId }, T0);
    const second = enqueueJob(database, { kind: "deploy", projectId }, T0);
    claimNextJob(database, "worker-1", T0);
    const bypassQueue = database.$client.query("UPDATE jobs SET status = 'running' WHERE id = ?");

    const forceSecondRunning = () => bypassQueue.run(second.id);

    expect(forceSecondRunning).toThrow(/UNIQUE constraint failed/);
  });

  test("returns the active job instead of creating a duplicate for the same dedupe key", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    const first = enqueueJob(
      database,
      { kind: "container_action", projectId, dedupeKey: "restart:api" },
      T0,
    );

    const second = enqueueJob(
      database,
      { kind: "container_action", projectId, dedupeKey: "restart:api" },
      T0,
    );

    expect(second).toEqual({ id: first.id, created: false });
  });

  test("allows a new job with the same dedupe key after the previous one finished", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    const first = enqueueJob(
      database,
      { kind: "container_action", projectId, dedupeKey: "restart:api" },
      T0,
    );
    claimNextJob(database, "worker-1", T0);
    completeJob(database, first.id, T0);

    const second = enqueueJob(
      database,
      { kind: "container_action", projectId, dedupeKey: "restart:api" },
      T0,
    );

    expect(second.created).toBe(true);
  });

  test("requeues a retryable failure while attempts remain", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    enqueueJob(database, { kind: "deploy", projectId, maxAttempts: 2 }, T0);
    const job = claimNextJob(database, "worker-1", T0);

    const outcome = failJob(database, job?.id ?? "", {
      errorMessage: "boom",
      retryable: true,
      now: T0,
    });

    expect(outcome).toBe("requeued");
  });

  test("fails permanently when attempts are exhausted", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    enqueueJob(database, { kind: "deploy", projectId, maxAttempts: 1 }, T0);
    const job = claimNextJob(database, "worker-1", T0);

    const outcome = failJob(database, job?.id ?? "", {
      errorMessage: "boom",
      retryable: true,
      now: T0,
    });

    expect(outcome).toBe("failed");
  });

  test("recovers a job whose worker stopped renewing the lease", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    const { id } = enqueueJob(database, { kind: "deploy", projectId, maxAttempts: 2 }, T0);
    claimNextJob(database, "worker-1", T0);
    const afterLease = new Date(T0.getTime() + JOB_LEASE_IN_MS + 1);

    const recovered = recoverExpiredJobs(database, afterLease);

    expect(recovered).toEqual([
      { id, kind: "deploy", deploymentId: null, taskExecutionId: null, outcome: "requeued" },
    ]);
  });

  test("does not recover jobs whose lease is still valid", () => {
    const database = openMemoryDatabase();
    const projectId = insertProject(database, "api");
    enqueueJob(database, { kind: "deploy", projectId }, T0);
    claimNextJob(database, "worker-1", T0);

    const recovered = recoverExpiredJobs(database, new Date(T0.getTime() + 1000));

    expect(recovered).toEqual([]);
  });
});
