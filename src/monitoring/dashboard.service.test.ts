import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { listProjects } from "@/projects";
import { createTestProject } from "@/testing";

import { replaceContainerSnapshots } from "./container-snapshot.service";
import { environmentHealth, getDashboardSummary } from "./dashboard.service";

const NOW = new Date("2026-10-28T15:00:00Z");
const DISPLAY_LIMIT = 8;

function insertDeployment(
  database: Database,
  projectId: string,
  values: {
    readonly status: (typeof tables.deployments.$inferInsert)["status"];
    readonly createdAt: string;
  },
): string {
  const id = crypto.randomUUID();
  database
    .insert(tables.deployments)
    .values({
      id,
      projectId,
      trigger: "manual",
      triggeredByLabel: "test",
      branch: "main",
      status: values.status,
      createdAt: values.createdAt,
    })
    .run();
  return id;
}

describe("getDashboardSummary", () => {
  test("counts every deploy and failure of the last day, beyond the listed ones", () => {
    const database = openMemoryDatabase();
    const projectId = createTestProject(database).id;
    for (let index = 0; index < DISPLAY_LIMIT + 2; index += 1) {
      insertDeployment(database, projectId, {
        status: "failed",
        createdAt: "2026-10-28T14:00:00Z",
      });
    }
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T13:00:00Z",
    });

    const summary = getDashboardSummary(database, NOW);

    expect(summary.deploymentsLastDayCount).toBe(DISPLAY_LIMIT + 3);
    expect(summary.failuresLastDayCount).toBe(DISPLAY_LIMIT + 2);
    expect(summary.recentFailures).toHaveLength(DISPLAY_LIMIT);
  });

  test("leaves out deploys older than a day", () => {
    const database = openMemoryDatabase();
    const projectId = createTestProject(database).id;
    insertDeployment(database, projectId, { status: "failed", createdAt: "2026-10-27T14:00:00Z" });

    const summary = getDashboardSummary(database, NOW);

    expect(summary.deploymentsLastDayCount).toBe(0);
    expect(summary.failuresLastDayCount).toBe(0);
  });

  test("summarizes only the given projects", () => {
    const database = openMemoryDatabase();
    const hidden = createTestProject(database).id;
    const visible = createTestProject(database, { name: "Web", slug: "web" }).id;
    insertDeployment(database, hidden, { status: "failed", createdAt: "2026-10-28T14:00:00Z" });
    insertDeployment(database, visible, { status: "succeeded", createdAt: "2026-10-28T14:00:00Z" });

    const summary = getDashboardSummary(database, NOW, [visible]);

    expect(summary.projectCount).toBe(1);
    expect(summary.deploymentsLastDayCount).toBe(1);
    expect(summary.failuresLastDayCount).toBe(0);
    expect(summary.recentDeployments.map((deployment) => deployment.projectId)).toEqual([visible]);
  });

  test("counts zero without any deploy", () => {
    const database = openMemoryDatabase();

    const summary = getDashboardSummary(database, NOW);

    expect(summary.deploymentsLastDayCount).toBe(0);
    expect(summary.failuresLastDayCount).toBe(0);
  });

  test("counts a project whose replicas are all unhealthy once", () => {
    const database = openMemoryDatabase();
    const projectId = createTestProject(database).id;
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T14:00:00Z",
    });
    const deploymentId =
      database.select({ id: tables.deployments.id }).from(tables.deployments).get()?.id ?? "";
    database
      .update(tables.projects)
      .set({ currentDeploymentId: deploymentId })
      .where(eq(tables.projects.id, projectId))
      .run();
    const replica = {
      projectId,
      deploymentId,
      image: "nelcota/api:abc",
      state: "running",
      health: "unhealthy",
      restartCount: 0,
      startedAt: "2026-10-28T14:00:00Z",
      observedAt: "2026-10-28T14:30:00Z",
    };
    replaceContainerSnapshots(database, "local", [
      { ...replica, containerId: "c1", name: "nelcota-api-1" },
      { ...replica, containerId: "c2", name: "nelcota-api-1-2" },
    ]);

    const summary = getDashboardSummary(database, NOW);

    expect(summary.unhealthyCount).toBe(1);
    expect(summary.onlineCount).toBe(1);
    expect(summary.projectsNeedingAttention.map((project) => [project.id, project.status])).toEqual(
      [[projectId, "unhealthy"]],
    );
  });
});

test("lists published projects without running containers and excludes unpublished or hidden projects", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const hidden = createTestProject(database, { name: "Hidden", slug: "hidden" });
  const unpublished = createTestProject(database, { name: "New", slug: "new" });
  for (const candidate of [project, hidden]) {
    const deploymentId = insertDeployment(database, candidate.id, {
      status: "succeeded",
      createdAt: NOW.toISOString(),
    });
    database
      .update(tables.projects)
      .set({ currentDeploymentId: deploymentId })
      .where(eq(tables.projects.id, candidate.id))
      .run();
  }

  const summary = getDashboardSummary(database, NOW, [project.id, unpublished.id]);

  expect(summary.projectsNeedingAttention).toEqual([
    { id: project.id, name: project.name, status: "unmonitored" },
  ]);
  expect(summary.unmonitoredCount).toBe(1);
  expect(summary.neverDeployedCount).toBe(1);
});

test("classifies a release consistently when its newest replica looks healthy", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const deploymentId = insertDeployment(database, project.id, {
    status: "succeeded",
    createdAt: "2026-10-28T14:00:00Z",
  });
  database.update(tables.projects).set({ currentDeploymentId: deploymentId }).run();
  const replica = {
    projectId: project.id,
    deploymentId,
    image: "nelcota/api:abc",
    state: "running",
  };
  replaceContainerSnapshots(database, "local", [
    {
      ...replica,
      containerId: "c1",
      name: "api-1",
      health: "healthy",
      observedAt: NOW.toISOString(),
    },
    {
      ...replica,
      containerId: "c2",
      name: "api-2",
      health: "unhealthy",
      observedAt: "2026-10-28T14:59:00Z",
    },
  ]);

  const summary = getDashboardSummary(database, NOW);
  const [listedProject] = listProjects(database);

  expect(listedProject?.runtimeStatus).toBe("unhealthy");
  expect(summary.projectsNeedingAttention).toEqual([
    { id: project.id, name: project.name, status: "unhealthy" },
  ]);
});

test("lists active deploys even when newer finished deploys fill the recent list", () => {
  const database = openMemoryDatabase();
  const visible = createTestProject(database);
  const hidden = createTestProject(database, { name: "Hidden", slug: "hidden" });
  const queued = insertDeployment(database, visible.id, {
    status: "queued",
    createdAt: "2026-10-25T14:00:00Z",
  });
  insertDeployment(database, hidden.id, { status: "building", createdAt: NOW.toISOString() });
  for (let index = 0; index < DISPLAY_LIMIT; index += 1) {
    insertDeployment(database, visible.id, { status: "succeeded", createdAt: NOW.toISOString() });
  }

  const summary = getDashboardSummary(database, NOW, [visible.id]);

  expect(summary.activeDeployments.map((deployment) => deployment.id)).toEqual([queued]);
  expect(summary.recentDeployments.some((deployment) => deployment.id === queued)).toBe(false);
});

const ONLINE_WORKER = {
  workerId: "worker-1",
  startedAt: "2026-10-28T14:00:00Z",
  lastSeenAt: "2026-10-28T15:00:00Z",
  dockerVersion: "27.0.0",
  online: true,
  dockerAvailable: true,
};

describe("environmentHealth", () => {
  test("is unavailable when no worker ever reported", () => {
    const health = environmentHealth(null, { offline: 0, unhealthy: 0 });

    expect(health).toBe("unavailable");
  });

  test("is unavailable when Docker is not available", () => {
    const worker = { ...ONLINE_WORKER, dockerAvailable: false };

    const health = environmentHealth(worker, { offline: 0, unhealthy: 0 });

    expect(health).toBe("unavailable");
  });

  test("is degraded when a deployed project is offline", () => {
    const health = environmentHealth(ONLINE_WORKER, { offline: 1, unhealthy: 0 });

    expect(health).toBe("degraded");
  });

  test("is degraded when a project is unhealthy", () => {
    const health = environmentHealth(ONLINE_WORKER, { offline: 0, unhealthy: 1 });

    expect(health).toBe("degraded");
  });

  test("is healthy when the worker runs and every project is fine", () => {
    const health = environmentHealth(ONLINE_WORKER, { offline: 0, unhealthy: 0 });

    expect(health).toBe("healthy");
  });
});
