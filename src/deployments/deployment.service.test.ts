import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { createProject } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestContainerAction } from "./container-action.service";
import { InvalidDeploymentTransitionError } from "./deployment-status";
import {
  NoActiveContainerError,
  ProjectNotApprovedError,
  RollbackUnavailableError,
} from "./deployment.errors";
import {
  cancelDeployment,
  completeDeployment,
  getDeployment,
  requestDeployment,
  transitionDeployment,
} from "./deployment.service";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

function finishSuccessfully(
  database: ReturnType<typeof openMemoryDatabase>,
  deploymentId: string,
): void {
  transitionDeployment(database, deploymentId, "cloning");
  transitionDeployment(database, deploymentId, "building");
  transitionDeployment(database, deploymentId, "starting", {
    imageTag: "nelcota/api:abc",
    containerName: "nelcota-api-abc",
  });
  transitionDeployment(database, deploymentId, "health_checking");
  completeDeployment(database, deploymentId);
}

describe("requestDeployment", () => {
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

  test("does not deploy the same pushed commit twice while it is in progress", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const sha = "a".repeat(40);
    const first = requestDeployment(database, { projectId: project.id, ...manual, commitSha: sha });
    transitionDeployment(database, first.deploymentId, "cloning");

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
    transitionDeployment(database, failed.deploymentId, "failed", { errorMessage: "boom" });

    const rollback = () =>
      requestDeployment(database, {
        projectId: project.id,
        ...manual,
        trigger: "rollback",
        sourceDeploymentId: failed.deploymentId,
      });

    expect(rollback).toThrow(RollbackUnavailableError);
  });

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

describe("deployment lifecycle", () => {
  test("completing a deployment makes it the project's current deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });

    finishSuccessfully(database, deploymentId);

    const row = database
      .select({ current: tables.projects.currentDeploymentId })
      .from(tables.projects)
      .get();
    expect(row?.current).toBe(deploymentId);
    expect(getDeployment(database, deploymentId).finishedAt).not.toBeNull();
  });

  test("throws InvalidDeploymentTransitionError when skipping the build", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, deploymentId, "cloning");

    expect(() => transitionDeployment(database, deploymentId, "succeeded")).toThrow(
      InvalidDeploymentTransitionError,
    );
  });

  test("throws InvalidDeploymentTransitionError when leaving a terminal state", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, deploymentId, "failed");

    expect(() => transitionDeployment(database, deploymentId, "cloning")).toThrow(
      InvalidDeploymentTransitionError,
    );
  });

  test("cancels a queued deployment immediately", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });

    const result = cancelDeployment(database, deploymentId, TEST_ACTOR);

    expect(result).toBe("cancelled");
    expect(claimNextJob(database, "worker")).toBeNull();
  });

  test("asks the worker to stop a running deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, deploymentId, "cloning");

    const result = cancelDeployment(database, deploymentId, TEST_ACTOR);

    expect(result).toBe("cancelling");
    expect(getDeployment(database, deploymentId).cancelRequestedAt).not.toBeNull();
  });
});

describe("requestContainerAction", () => {
  test("throws NoActiveContainerError before the first successful deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    expect(() =>
      requestContainerAction(database, {
        projectId: project.id,
        action: "restart",
        actor: TEST_ACTOR,
      }),
    ).toThrow(NoActiveContainerError);
  });

  test("deduplicates repeated clicks while the action is pending", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    finishSuccessfully(database, deploymentId);
    const first = requestContainerAction(database, {
      projectId: project.id,
      action: "restart",
      actor: TEST_ACTOR,
    });

    const second = requestContainerAction(database, {
      projectId: project.id,
      action: "restart",
      actor: TEST_ACTOR,
    });

    expect(second).toEqual({ jobId: first.jobId, created: false });
  });
});
