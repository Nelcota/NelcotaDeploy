import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import { listMoveLeftovers, replaceContainerSnapshots } from "./monitoring.service";

const OLD_SERVER = "local";
const NEW_SERVER = "apps";
const NOW = "2026-10-29T12:00:00.000Z";

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
