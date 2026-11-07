import { describe, expect, test } from "bun:test";

import { count, eq } from "drizzle-orm";

import { createProjectDatabase, ProjectHasDatabasesError } from "@/databases";
import { type Database, openMemoryDatabase, tables } from "@/db";
import {
  completeDeployment,
  getDeployment,
  ProjectNotApprovedError,
  requestDeployment,
  RollbackUnavailableError,
  transitionDeployment,
} from "@/deployments";
import { openPreview } from "@/previews";
import { getProject, ProjectNotFoundError } from "@/projects";
import {
  addServer,
  ProjectMoveInProgressError,
  ProjectMoveReviewChangedError,
  recordServerCheck,
  removeServer,
  ServerNotFoundError,
  ServerNotReadyError,
} from "@/servers";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";
import { addProjectVolume, ProjectHasVolumesError, setVolumeAttached } from "@/volumes";

import { moveProject, projectMoveStatus } from "./project-move.service";

const context = { actor: TEST_ACTOR, triggeredByUserId: null };

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const target = addServer(database, {
    input: { name: "apps-1", host: "203.0.113.10", port: 22, username: "nelcota" },
    actor: TEST_ACTOR,
  });
  recordServerCheck(database, target.id, { status: "ready", message: null, dockerVersion: "29" });
  const review = () => {
    const current = getProject(database, project.id);
    return {
      projectId: current.id,
      serverId: target.id,
      expectedServerId: current.serverId,
      expectedDeploymentId: current.currentDeploymentId,
      expectedUpdatedAt: current.updatedAt,
    };
  };
  return { database, project, target, review };
}

function writeCounts(database: Database) {
  return {
    deployments: database.select({ total: count() }).from(tables.deployments).get()?.total ?? 0,
    jobs: database.select({ total: count() }).from(tables.jobs).get()?.total ?? 0,
    audit: database.select({ total: count() }).from(tables.auditEvents).get()?.total ?? 0,
  };
}

function deployLive(database: Database, projectId: string): string {
  const { deploymentId } = requestDeployment(database, {
    projectId,
    trigger: "manual",
    ...context,
  });
  transitionDeployment(database, deploymentId, { to: "cloning", commitSha: "a".repeat(40) });
  transitionDeployment(database, deploymentId, { to: "building" });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: "nelcota/api:live",
    containerName: "api-live",
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  return deploymentId;
}

describe("projectMoveStatus", () => {
  test("reads the source revision without writing", () => {
    const { database, project } = setup();
    const before = writeCounts(database);

    expect(projectMoveStatus(database, project.id)).toEqual({
      serverId: project.serverId,
      currentDeploymentId: null,
      updatedAt: project.updatedAt,
      deploymentsApproved: true,
      volumeCount: 0,
      databaseCount: 0,
      activeDeployment: null,
    });
    expect(writeCounts(database)).toEqual(before);
  });

  test("includes detached volumes that still retain local data", () => {
    const { database, project } = setup();
    const volume = addProjectVolume(database, {
      projectId: project.id,
      input: { mountPath: "/app/data" },
      actor: TEST_ACTOR,
    });
    setVolumeAttached(database, {
      projectId: project.id,
      volumeId: volume.id,
      attached: false,
      actor: TEST_ACTOR,
    });

    expect(projectMoveStatus(database, project.id).volumeCount).toBe(1);
  });

  test("refuses a missing project instead of reporting empty prerequisites", () => {
    const { database } = setup();

    expect(() => projectMoveStatus(database, "missing-project")).toThrow(ProjectNotFoundError);
  });
});

describe("moveProject source review", () => {
  test("rejects a removed project without writing", () => {
    const { database, review } = setup();
    const before = writeCounts(database);

    expect(() => moveProject(database, { ...review(), projectId: "missing" }, context)).toThrow(
      ProjectNotFoundError,
    );
    expect(writeCounts(database)).toEqual(before);
  });

  test("moves an undeployed project without queuing work", () => {
    const { database, project, target, review } = setup();
    const before = writeCounts(database);

    const result = moveProject(database, review(), context);

    expect(result).toEqual({ serverId: target.id, deploymentId: null, changed: true });
    expect(getProject(database, project.id).serverId).toBe(target.id);
    expect(writeCounts(database)).toEqual({ ...before, audit: before.audit + 1 });
  });

  test("treats a retry already at the destination as an idempotent no-op", () => {
    const { database, review } = setup();
    const request = review();
    moveProject(database, request, context);
    const before = writeCounts(database);

    expect(moveProject(database, request, context).changed).toBe(false);
    expect(writeCounts(database)).toEqual(before);
  });

  test.each(["expectedServerId", "expectedDeploymentId", "expectedUpdatedAt"] as const)(
    "rejects a stale %s without writing",
    (field) => {
      const { database, project, review } = setup();
      const before = writeCounts(database);

      expect(() => moveProject(database, { ...review(), [field]: "stale" }, context)).toThrow(
        ProjectMoveReviewChangedError,
      );
      expect(getProject(database, project.id).serverId).toBe(project.serverId);
      expect(writeCounts(database)).toEqual(before);
    },
  );
});

describe("moveProject deployment", () => {
  test("queues the reviewed live image on the destination and keeps the current deployment", () => {
    const { database, project, target, review } = setup();
    const liveId = deployLive(database, project.id);

    const result = moveProject(database, review(), context);
    const deployment = getDeployment(database, result.deploymentId ?? "");

    expect(deployment.serverId).toBe(target.id);
    expect(deployment.sourceDeploymentId).toBe(liveId);
    expect(deployment.status).toBe("queued");
    expect(getProject(database, project.id).currentDeploymentId).toBe(liveId);
    expect(getProject(database, project.id).serverId).toBe(target.id);
  });

  test("does not supersede an active production deployment", () => {
    const { database, project, review } = setup();
    const queued = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      ...context,
    });
    const before = writeCounts(database);

    expect(() => moveProject(database, review(), context)).toThrow(ProjectMoveInProgressError);
    expect(getDeployment(database, queued.deploymentId).status).toBe("queued");
    expect(writeCounts(database)).toEqual(before);
  });

  test("does not mistake an active preview for production", () => {
    const { database, project, target, review } = setup();
    const previewId = openPreview(database, {
      projectId: project.id,
      number: 7,
      branch: "feature/test",
      headSha: "b".repeat(40),
    });
    requestDeployment(database, {
      projectId: project.id,
      previewId,
      trigger: "manual",
      ...context,
    });

    expect(projectMoveStatus(database, project.id).activeDeployment).toBeNull();
    expect(moveProject(database, review(), context).serverId).toBe(target.id);
  });

  test("refuses a deployed project awaiting approval without changing its server", () => {
    const { database, project, review } = setup();
    deployLive(database, project.id);
    database
      .update(tables.projects)
      .set({ deploymentsApproved: false })
      .where(eq(tables.projects.id, project.id))
      .run();
    const before = writeCounts(database);

    expect(() => moveProject(database, review(), context)).toThrow(ProjectNotApprovedError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });
});

describe("moveProject local state", () => {
  test("blocks volumes created after the review", () => {
    const { database, project, review } = setup();
    const request = review();
    addProjectVolume(database, {
      projectId: project.id,
      input: { mountPath: "/app/data" },
      actor: TEST_ACTOR,
    });
    const before = writeCounts(database);

    expect(() => moveProject(database, request, context)).toThrow(ProjectHasVolumesError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });

  test("counts and blocks a database without moving its data", async () => {
    const { database, project, review } = setup();
    await createProjectDatabase(database, await createTestSecretBox(), {
      projectId: project.id,
      input: { engine: "postgres", environmentKey: "DATABASE_URL" },
      actor: TEST_ACTOR,
    });
    const before = writeCounts(database);

    expect(projectMoveStatus(database, project.id).databaseCount).toBe(1);
    expect(() => moveProject(database, review(), context)).toThrow(ProjectHasDatabasesError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });

  test("rejects a destination that disappeared", () => {
    const { database, target, project, review } = setup();
    const request = review();
    removeServer(database, { serverId: target.id, actor: TEST_ACTOR });
    const before = writeCounts(database);

    expect(() => moveProject(database, request, context)).toThrow(ServerNotFoundError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });

  test("rejects a destination that lost its connection", () => {
    const { database, target, project, review } = setup();
    recordServerCheck(database, target.id, {
      status: "unreachable",
      message: "timeout",
      dockerVersion: null,
    });
    const before = writeCounts(database);

    expect(() => moveProject(database, review(), context)).toThrow(ServerNotReadyError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });
});

describe("moveProject atomicity", () => {
  test("rolls back placement and audit when the source image is unavailable", () => {
    const { database, project, review } = setup();
    const liveId = deployLive(database, project.id);
    database
      .update(tables.deployments)
      .set({ imageTag: null })
      .where(eq(tables.deployments.id, liveId))
      .run();
    const before = writeCounts(database);

    expect(() => moveProject(database, review(), context)).toThrow(RollbackUnavailableError);
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });

  test("rolls back placement, deployment, queue and audit if enqueue fails", () => {
    const { database, project, review } = setup();
    deployLive(database, project.id);
    database.$client.run(
      "CREATE TRIGGER reject_move_job BEFORE INSERT ON jobs WHEN new.kind = 'deploy' BEGIN SELECT RAISE(ABORT, 'fixture queue rejected'); END",
    );
    const before = writeCounts(database);

    expect(() => moveProject(database, review(), context)).toThrow("fixture queue rejected");
    expect(getProject(database, project.id).serverId).toBe(project.serverId);
    expect(writeCounts(database)).toEqual(before);
  });
});
