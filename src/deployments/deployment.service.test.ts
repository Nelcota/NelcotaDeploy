import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { claimNextJob } from "@/jobs";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestContainerAction } from "./container-action.service";
import { requestDeployment } from "./deployment-request.service";
import { InvalidDeploymentTransitionError } from "./deployment-status";
import { NoActiveContainerError } from "./deployment.errors";
import {
  cancelDeployment,
  completeDeployment,
  countActiveDeployments,
  getDeployment,
  listDeployments,
  transitionDeployment,
} from "./deployment.service";

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

  test("marks only the project's current deployment as live", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const first = requestDeployment(database, { projectId: project.id, ...manual });
    finishSuccessfully(database, first.deploymentId);
    const second = requestDeployment(database, { projectId: project.id, ...manual });

    const rows = listDeployments(database, { projectId: project.id, limit: 10 });

    expect(rows.find((row) => row.id === first.deploymentId)?.isLive).toBe(true);
    expect(rows.find((row) => row.id === second.deploymentId)?.isLive).toBe(false);
  });
});

describe("deployment transitions", () => {
  test("throws InvalidDeploymentTransitionError when skipping the build", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, deploymentId, { to: "cloning" });

    expect(() => transitionDeployment(database, deploymentId, { to: "succeeded" })).toThrow(
      InvalidDeploymentTransitionError,
    );
  });

  test("throws InvalidDeploymentTransitionError when leaving a terminal state", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const { deploymentId } = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, deploymentId, { to: "failed" });

    expect(() => transitionDeployment(database, deploymentId, { to: "cloning" })).toThrow(
      InvalidDeploymentTransitionError,
    );
  });
});

describe("deployment cancellation", () => {
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
    transitionDeployment(database, deploymentId, { to: "cloning" });

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

describe("countActiveDeployments", () => {
  test("counts queued and running deployments but not finished ones", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const finished = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      commitSha: "a".repeat(40),
    });
    transitionDeployment(database, finished.deploymentId, { to: "failed" });
    const running = requestDeployment(database, {
      projectId: project.id,
      ...manual,
      commitSha: "b".repeat(40),
    });
    transitionDeployment(database, running.deploymentId, { to: "cloning" });
    requestDeployment(database, { projectId: project.id, ...manual, commitSha: "c".repeat(40) });

    expect(countActiveDeployments(database)).toBe(2);
  });
});
