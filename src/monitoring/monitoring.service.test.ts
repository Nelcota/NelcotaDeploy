import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import {
  combineSamplesByProject,
  highestRestartCounts,
  listHostSamples,
  listMoveLeftovers,
  listProjectSamples,
  replaceContainerSnapshots,
} from "./monitoring.service";

const OLD_SERVER = "local";
const NEW_SERVER = "apps";
const NOW = "2026-10-29T12:00:00.000Z";

describe("highestRestartCounts", () => {
  test("reports the most restarted container of each deployment", () => {
    const database = openMemoryDatabase();
    const projectId = createTestProject(database).id;
    const [first, second] = ["d1", "d2"].map((id) => {
      database
        .insert(tables.deployments)
        .values({
          id,
          projectId,
          trigger: "manual",
          triggeredByLabel: "test",
          branch: "main",
          status: "succeeded",
          createdAt: NOW,
        })
        .run();
      return id;
    });
    const snapshot = {
      projectId,
      image: "nelcota/api",
      state: "running",
      health: null,
      startedAt: NOW,
      observedAt: NOW,
    };
    replaceContainerSnapshots(database, OLD_SERVER, [
      { ...snapshot, containerId: "a", name: "a", deploymentId: first ?? "", restartCount: 1 },
      { ...snapshot, containerId: "b", name: "b", deploymentId: first ?? "", restartCount: 4 },
      { ...snapshot, containerId: "c", name: "c", deploymentId: second ?? "", restartCount: 0 },
    ]);

    const counts = highestRestartCounts(database, ["d1", "d2"]);

    expect(counts).toEqual(
      new Map([
        ["d1", 4],
        ["d2", 0],
      ]),
    );
  });

  test("returns nothing for no deployments", () => {
    expect(highestRestartCounts(openMemoryDatabase(), [])).toEqual(new Map());
  });

  test("leaves out deployments without containers", () => {
    const database = openMemoryDatabase();

    expect(highestRestartCounts(database, ["missing"]).size).toBe(0);
  });
});

describe("combineSamplesByProject", () => {
  test("adds up the replicas of a project into one sample", () => {
    const replica = {
      projectId: "api",
      cpuPercent: 10,
      memoryUsedBytes: 100,
      memoryTotalBytes: 1000,
    };

    const combined = combineSamplesByProject([replica, { ...replica, cpuPercent: 30 }]);

    expect(combined).toEqual([
      { projectId: "api", cpuPercent: 40, memoryUsedBytes: 200, memoryTotalBytes: 2000 },
    ]);
  });

  test("keeps the projects apart", () => {
    const sample = { cpuPercent: 1, memoryUsedBytes: 1, memoryTotalBytes: 1 };

    const combined = combineSamplesByProject([
      { projectId: "api", ...sample },
      { projectId: "web", ...sample },
    ]);

    expect(combined.map((item) => item.projectId)).toEqual(["api", "web"]);
  });

  test("leaves a figure no replica reported as null", () => {
    const replica = {
      projectId: "api",
      cpuPercent: null,
      memoryUsedBytes: 5,
      memoryTotalBytes: null,
    };

    const [combined] = combineSamplesByProject([replica, replica]);

    expect(combined).toEqual({
      projectId: "api",
      cpuPercent: null,
      memoryUsedBytes: 10,
      memoryTotalBytes: null,
    });
  });

  test("returns nothing for no samples", () => {
    expect(combineSamplesByProject([])).toEqual([]);
  });
});

test.each(["host", "container"] as const)(
  "keeps the newest readings when the %s metric window exceeds its limit",
  (scope) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const project = createTestProject(database);
    database.$client
      .query(
        "WITH RECURSIVE sequence(value) AS (SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 2000) INSERT INTO metric_samples(scope, project_id, server_id, created_at) SELECT ?, ?, 'local', strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-01T00:00:00Z', '+' || (value * 15) || ' seconds') FROM sequence",
      )
      .run(scope, scope === "host" ? null : project.id);
    const since = new Date("2026-11-01T00:00:00Z");

    const samples =
      scope === "host"
        ? listHostSamples(database, "local", since)
        : listProjectSamples(database, project.id, since);

    expect(samples).toHaveLength(2000);
    expect(samples.at(0)?.createdAt).toBe("2026-11-01T00:00:15.000Z");
    expect(samples.at(-1)?.createdAt).toBe("2026-11-01T08:20:00.000Z");
  },
);

function addServerRow(database: Database, id: string): void {
  database
    .insert(tables.servers)
    .values({ id, name: id, kind: "ssh", status: "ready", createdAt: NOW, updatedAt: NOW })
    .run();
}

function addDeployment(
  database: Database,
  projectId: string,
  deployment: { readonly serverId: string; readonly status: "succeeded" | "building" },
): string {
  const id = Bun.randomUUIDv7();
  database
    .insert(tables.deployments)
    .values({
      id,
      projectId,
      status: deployment.status,
      trigger: "manual",
      triggeredByLabel: "test",
      branch: "main",
      serverId: deployment.serverId,
      createdAt: NOW,
      finishedAt: deployment.status === "succeeded" ? NOW : null,
    })
    .run();
  return id;
}

function snapshot(database: Database, projectId: string, serverId: string): void {
  replaceContainerSnapshots(database, serverId, [
    {
      containerId: `container-${serverId}`,
      projectId,
      deploymentId: null,
      name: `nelcota-api-${serverId}`,
      image: "nelcota/api:abc",
      state: "running",
      health: null,
      restartCount: 0,
      startedAt: NOW,
      observedAt: NOW,
    },
  ]);
}

/** A project that went live on the new server and still has its old container on the old one. */
function movedProject(database: Database): string {
  addServerRow(database, NEW_SERVER);
  const project = createTestProject(database);
  const live = addDeployment(database, project.id, { serverId: NEW_SERVER, status: "succeeded" });
  database
    .update(tables.projects)
    .set({ serverId: NEW_SERVER, currentDeploymentId: live })
    .where(eq(tables.projects.id, project.id))
    .run();
  snapshot(database, project.id, OLD_SERVER);
  snapshot(database, project.id, NEW_SERVER);
  return project.id;
}

describe("listMoveLeftovers", () => {
  test("finds the container a moved project left on its old server", () => {
    const database = openMemoryDatabase();
    const projectId = movedProject(database);

    const leftovers = listMoveLeftovers(database);

    expect(leftovers).toEqual([
      { projectId, currentServerId: NEW_SERVER, otherServerId: OLD_SERVER, liveSince: NOW },
    ]);
  });

  test("skips a project while one of its deployments is in progress", () => {
    const database = openMemoryDatabase();
    const projectId = movedProject(database);
    addDeployment(database, projectId, { serverId: NEW_SERVER, status: "building" });

    expect(listMoveLeftovers(database)).toEqual([]);
  });

  test("never treats the server the project is placed on as the old one", () => {
    const database = openMemoryDatabase();
    const projectId = movedProject(database);
    database
      .update(tables.projects)
      .set({ serverId: OLD_SERVER })
      .where(eq(tables.projects.id, projectId))
      .run();

    expect(listMoveLeftovers(database)).toEqual([]);
  });
});

describe("replaceContainerSnapshots", () => {
  test("keeps the containers other servers reported", () => {
    const database = openMemoryDatabase();
    const projectId = movedProject(database);

    replaceContainerSnapshots(database, OLD_SERVER, []);

    const remaining = database
      .select({ serverId: tables.containerSnapshots.serverId })
      .from(tables.containerSnapshots)
      .where(eq(tables.containerSnapshots.projectId, projectId))
      .all();
    expect(remaining).toEqual([{ serverId: NEW_SERVER }]);
  });
});
