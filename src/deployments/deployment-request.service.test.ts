import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { createProject } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestDeployment, retryDeployment } from "./deployment-request.service";
import {
  RetryUnavailableError,
  ProjectNotApprovedError,
  RollbackUnavailableError,
} from "./deployment.errors";
import { completeDeployment, getDeployment, transitionDeployment } from "./deployment.service";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

function finishSuccessfully(
  database: ReturnType<typeof openMemoryDatabase>,
  deploymentId: string,
): void {
  transitionDeployment(database, deploymentId, { to: "cloning" });
  transitionDeployment(database, deploymentId, { to: "building" });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api:abc",
    containerName: "nelcota-api-abc",
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
}
describe("requestDeployment queueing", () => {
  test("persists a queued deployment and a deploy job", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const { deploymentId, created } = requestDeployment(database, {
      projectId: project.id,
      ...manual,
    });

    expect(created).toBe(true);
    expect(getDeployment(database, deploymentId).status).toBe("queued");
    const job = claimNextJob(database, "worker");
    expect(job?.deploymentId).toBe(deploymentId);
    expect(job?.kind).toBe("deploy");
  });

  test("returns the queued deployment when the same request repeats", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const first = requestDeployment(database, { projectId: project.id, ...manual });

    const second = requestDeployment(database, { projectId: project.id, ...manual });

    expect(second).toEqual({ deploymentId: first.deploymentId, created: false });
  });
});

describe("requestDeployment deduplication", () => {
  test("does not deploy the same pushed commit twice while it is in progress", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const sha = "a".repeat(40);
    const first = requestDeployment(database, { projectId: project.id, ...manual, commitSha: sha });
    transitionDeployment(database, first.deploymentId, { to: "cloning" });

    const second = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      commitSha: sha,
    });

    expect(second.created).toBe(false);
  });

  test("cancels an older queued deployment superseded by a newer commit", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const older = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      commitSha: "a".repeat(40),
    });

    requestDeployment(database, { projectId: project.id, ...manual, commitSha: "b".repeat(40) });

    expect(getDeployment(database, older.deploymentId).status).toBe("cancelled");
    const olderJob = database
      .select({ status: tables.jobs.status })
      .from(tables.jobs)
      .where(eq(tables.jobs.deploymentId, older.deploymentId))
      .get();
    expect(olderJob?.status).toBe("cancelled");
  });
});

describe("requestDeployment validation", () => {
  test("throws ProjectNotApprovedError for a project created by a non-admin", () => {
    const database = openMemoryDatabase();
    const project = createProject(
      database,
      {
        name: "Unknown",
        slug: "unknown",
        repositoryUrl: "https://github.com/someone/unknown",
        branch: "main",
        dockerfilePath: "Dockerfile",
        buildContext: ".",
        internalPort: 80,
        healthCheckPath: null,
        autoDeploy: false,
      },
      { actor: TEST_ACTOR, userId: null, isAdmin: false },
    );

    expect(() => requestDeployment(database, { projectId: project.id, ...manual })).toThrow(
      ProjectNotApprovedError,
    );
  });

  test("throws RollbackUnavailableError when the source deployment never succeeded", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const failed = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, failed.deploymentId, { to: "failed", errorMessage: "boom" });

    const rollback = () =>
      requestDeployment(database, {
        projectId: project.id,
        ...manual,
        trigger: "rollback",
        sourceDeploymentId: failed.deploymentId,
      });

    expect(rollback).toThrow(RollbackUnavailableError);
  });
});

describe("requestDeployment rollback", () => {
  test("a rollback reuses the image of a successful deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const previous = requestDeployment(database, { projectId: project.id, ...manual });
    finishSuccessfully(database, previous.deploymentId);

    const rollback = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      trigger: "rollback",
      sourceDeploymentId: previous.deploymentId,
    });

    expect(getDeployment(database, rollback.deploymentId).imageTag).toBe("nelcota/api:abc");
  });
});

describe("retryDeployment", () => {
  test("builds the same commit again after a failure", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      commitSha: "abc1234def",
    });
    transitionDeployment(database, deploymentId, { to: "failed", errorMessage: "build failed" });

    const retry = retryDeployment(database, deploymentId, {
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    });

    expect(retry.deploymentId).not.toBe(deploymentId);
    expect(getDeployment(database, retry.deploymentId).requestedCommitSha).toBe("abc1234def");
  });

  test("throws RetryUnavailableError for a deployment that succeeded", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    finishSuccessfully(database, deploymentId);

    expect(() =>
      retryDeployment(database, deploymentId, { actor: TEST_ACTOR, triggeredByUserId: null }),
    ).toThrow(RetryUnavailableError);
  });
});

describe("requestDeployment servers", () => {
  test("runs the deployment on the server the project is placed on", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });

    expect(getDeployment(database, deploymentId).serverId).toBe(project.serverId);
  });

  test("queues a new deployment after the project moved instead of reusing the old one", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const first = requestDeployment(database, { projectId: project.id, ...manual });
    database
      .insert(tables.servers)
      .values({
        id: "apps",
        name: "apps",
        kind: "ssh",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();
    database
      .update(tables.projects)
      .set({ serverId: "apps" })
      .where(eq(tables.projects.id, project.id))
      .run();

    const second = requestDeployment(database, { projectId: project.id, ...manual });

    expect(second.created).toBe(true);
    expect(second.deploymentId).not.toBe(first.deploymentId);
    expect(getDeployment(database, second.deploymentId).serverId).toBe("apps");
  });
});
