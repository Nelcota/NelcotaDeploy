import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

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
  firstPublishedDeploymentId,
  getDeployment,
  listDeployments,
  transitionDeployment,
} from "./deployment.service";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

test("identifies the first production publication by completion time and ignores failed attempts and previews", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const createdAt = "2026-11-01T12:00:00.000Z";
  database
    .insert(tables.previews)
    .values({
      id: "preview",
      projectId: project.id,
      pullRequestNumber: 1,
      branch: "feature",
      headSha: "abc",
      status: "active",
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  database
    .insert(tables.deployments)
    .values([
      {
        id: "failed",
        projectId: project.id,
        trigger: "manual",
        triggeredByLabel: "test",
        branch: "main",
        status: "failed",
        createdAt,
        finishedAt: createdAt,
      },
      {
        id: "preview",
        projectId: project.id,
        trigger: "manual",
        triggeredByLabel: "test",
        branch: "feature",
        status: "succeeded",
        previewId: "preview",
        createdAt,
        finishedAt: createdAt,
      },
      {
        id: "second",
        projectId: project.id,
        trigger: "manual",
        triggeredByLabel: "test",
        branch: "main",
        status: "succeeded",
        createdAt,
        finishedAt: "2026-11-01T15:00:00.000Z",
      },
      {
        id: "first",
        projectId: project.id,
        trigger: "manual",
        triggeredByLabel: "test",
        branch: "main",
        status: "succeeded",
        createdAt: "2026-11-01T13:00:00.000Z",
        finishedAt: "2026-11-01T14:00:00.000Z",
      },
    ])
    .run();

  expect(firstPublishedDeploymentId(database, project.id)).toBe("first");
  expect(firstPublishedDeploymentId(database, "other")).toBeNull();
});

test("paginates active deploys after excluding finished deploys and deleted or hidden projects", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const deleted = createTestProject(database, { name: "Deleted", slug: "deleted" });
  const hidden = createTestProject(database, { name: "Hidden", slug: "hidden" });
  const rows = [
    { id: "building", projectId: project.id, status: "building" },
    { id: "finished", projectId: project.id, status: "succeeded" },
    { id: "deleted", projectId: deleted.id, status: "queued" },
    { id: "hidden", projectId: hidden.id, status: "starting" },
    { id: "queued", projectId: project.id, status: "queued" },
  ] as const;
  database
    .insert(tables.deployments)
    .values(
      rows.map(({ id, projectId, status }): typeof tables.deployments.$inferInsert => ({
        id,
        projectId,
        status,
        createdAt: id === "queued" ? "2026-11-01T12:00:00Z" : "2026-11-01T14:00:00Z",
        trigger: "manual",
        triggeredByLabel: "test",
        branch: "main",
      })),
    )
    .run();
  database
    .update(tables.projects)
    .set({ deletionRequestedAt: "2026-11-01T15:00:00Z" })
    .where(eq(tables.projects.id, deleted.id))
    .run();

  const filters = {
    status: "active",
    projectIds: [project.id, deleted.id],
    limit: 1,
  } as const;
  const first = listDeployments(database, filters);
  const second = listDeployments(database, { ...filters, before: first.at(0) });

  expect(first.map(({ id }) => id)).toEqual(["building"]);
  expect(second.map(({ id }) => id)).toEqual(["queued"]);
});

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
  test("paginates deployments sharing a creation timestamp without dropping either", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const firstProject = createTestProject(database);
    const other = createTestProject(database, { name: "Other", slug: "other" });
    requestDeployment(database, { projectId: firstProject.id, ...manual });
    requestDeployment(database, { projectId: other.id, ...manual });
    database.update(tables.deployments).set({ createdAt: "2026-11-01T12:00:00.000Z" }).run();
    const first = listDeployments(database, { limit: 1 }).at(0);
    if (first == null) {
      throw new Error("Missing test deployment");
    }

    const second = listDeployments(database, {
      limit: 1,
      before: { createdAt: first.createdAt, id: first.id },
    });

    expect(second).toHaveLength(1);
    expect(second.at(0)?.id).not.toBe(first.id);
  });
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

    expect(countActiveDeployments(database, null)).toBe(2);
  });

  test("counts only the deployments of the given projects", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const other = createTestProject(database, { name: "Web", slug: "web" });
    requestDeployment(database, { projectId: project.id, ...manual, commitSha: "a".repeat(40) });
    requestDeployment(database, { projectId: other.id, ...manual, commitSha: "b".repeat(40) });

    expect(countActiveDeployments(database, [other.id])).toBe(1);
  });
});

describe("listDeployments with project ids", () => {
  test("lists only the deployments of the given projects", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const other = createTestProject(database, { name: "Web", slug: "web" });
    requestDeployment(database, { projectId: project.id, ...manual, commitSha: "a".repeat(40) });
    requestDeployment(database, { projectId: other.id, ...manual, commitSha: "b".repeat(40) });

    const deployments = listDeployments(database, { limit: 10, projectIds: [other.id] });

    expect(deployments.map((deployment) => deployment.projectId)).toEqual([other.id]);
  });
});
