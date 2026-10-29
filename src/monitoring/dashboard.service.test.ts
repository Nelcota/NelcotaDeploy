import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

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
): void {
  database
    .insert(tables.deployments)
    .values({
      id: crypto.randomUUID(),
      projectId,
      trigger: "manual",
      triggeredByLabel: "test",
      branch: "main",
      status: values.status,
      createdAt: values.createdAt,
    })
    .run();
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

  test("counts zero without any deploy", () => {
    const database = openMemoryDatabase();

    const summary = getDashboardSummary(database, NOW);

    expect(summary.deploymentsLastDayCount).toBe(0);
    expect(summary.failuresLastDayCount).toBe(0);
  });
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
