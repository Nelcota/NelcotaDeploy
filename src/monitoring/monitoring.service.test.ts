import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import { getDashboardSummary } from "./monitoring.service";

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
