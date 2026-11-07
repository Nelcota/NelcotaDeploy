import { expect, test } from "bun:test";

import {
  createProjectDatabase,
  listProjectDatabases,
  requestDatabaseDeletion,
  retryDatabaseProvision,
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
import { deleteDatabase, provisionDatabase } from "./database-runner";

async function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const secretBox = await createTestSecretBox();
  const docker = new FakeDocker();
  const created = await createProjectDatabase(database, secretBox, {
    projectId: project.id,
    input: { engine: "postgres", environmentKey: "DATABASE_URL" },
    actor: TEST_ACTOR,
  });
  const dependencies = {
    database,
    docker,
    secretBox,
    network: "review",
    readiness: { timeoutInMs: 100, intervalInMs: 1 },
  };
  const target = { projectId: project.id, databaseId: created.id, actor: TEST_ACTOR };
  const status = () => listProjectDatabases(database, project.id).at(0);
  return { database, project, docker, created, dependencies, target, status };
}

test.each([true, false])(
  "preserves the replacement database after lease loss, abort observed=%p",
  async (abortObserved) => {
    const context = await setup();
    using _connection = context.database.$client;
    const job = claimNextJob(context.database, "old-worker");
    if (job == null) {
      throw new Error("Expected a provision job");
    }
    await context.docker.runContainer(
      {
        containerName: context.created.host,
        imageTag: "postgres:18.6-alpine",
        network: "review",
        labels: { "io.nelcota.managed": "true" },
        environmentKeys: [],
        volumes: [],
      },
      {},
    );
    await context.docker.stopContainer(context.created.host);
    const inspect = context.docker.inspectContainer.bind(context.docker);
    const snapshot = await inspect(context.created.host);
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let first = true;
    context.docker.inspectContainer = async (reference) => {
      if (first) {
        first = false;
        started.resolve();
        await gate.promise;
        return snapshot;
      }
      return await inspect(reference);
    };
    const controller = new AbortController();
    const oldExecution = provisionDatabase(
      { ...context.dependencies, assertOwnership: () => assertJobOwnership(context.database, job) },
      context.created.id,
      controller.signal,
    ).catch((error: unknown) => error);
    await started.promise;
    handleRecoveredJobs(
      context.database,
      createLogger("test"),
      releaseWorkerJobs(context.database, "old-worker"),
    );
    if (abortObserved) {
      controller.abort(new JobLeaseLostError(job.id));
    }
    retryDatabaseProvision(context.database, context.target);
    const replacement = claimNextJob(context.database, "replacement");
    if (replacement == null) {
      throw new Error("Expected a replacement provision job");
    }
    await provisionDatabase(
      {
        ...context.dependencies,
        assertOwnership: () => assertJobOwnership(context.database, replacement),
      },
      context.created.id,
      new AbortController().signal,
    );
    completeJob(context.database, replacement);
    const callsBefore = context.docker.calls.length;
    gate.resolve();
    const failure = await oldExecution;

    expect(failure).toBeInstanceOf(JobLeaseLostError);
    expect(context.docker.calls.slice(callsBefore)).toEqual([]);
    expect(context.status()?.status).toBe("running");
    expect((await inspect(context.created.host))?.running).toBe(true);
  },
);

test("keeps the database and its volume when deletion loses its lease during inspection", async () => {
  const context = await setup();
  using _connection = context.database.$client;
  const provision = claimNextJob(context.database, "setup");
  if (provision == null) {
    throw new Error("Expected a provision job");
  }
  await provisionDatabase(context.dependencies, context.created.id, new AbortController().signal);
  completeJob(context.database, provision);
  requestDatabaseDeletion(context.database, context.target);
  const job = claimNextJob(context.database, "old-worker");
  if (job == null) {
    throw new Error("Expected a deletion job");
  }
  const inspect = context.docker.inspectContainer.bind(context.docker);
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  context.docker.inspectContainer = async (reference) => {
    const snapshot = await inspect(reference);
    started.resolve();
    await gate.promise;
    return snapshot;
  };

  const execution = deleteDatabase(
    {
      ...context.dependencies,
      storage: null,
      assertOwnership: () => assertJobOwnership(context.database, job),
    },
    context.created.id,
  ).catch((error: unknown) => error);
  await started.promise;
  handleRecoveredJobs(
    context.database,
    createLogger("test"),
    releaseWorkerJobs(context.database, "old-worker"),
  );
  gate.resolve();
  const failure = await execution;

  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect((await inspect(context.created.host))?.running).toBe(true);
  expect(await context.docker.volumes.listForProject(context.project.id)).toHaveLength(1);
  expect(context.status()?.deletionRequestedAt).toBeNull();
});
