import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { openPreview } from "@/previews";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { requestDeployment } from "./deployment-request.service";
import { transitionDeployment } from "./deployment.service";
import { getActiveRuntimeDeployment } from "./runtime-apply.service";

const manual = { trigger: "manual" as const, actor: TEST_ACTOR, triggeredByUserId: null };

describe("getActiveRuntimeDeployment progress", () => {
  test("returns null when production has no active deployment", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    expect(getActiveRuntimeDeployment(database, project.id)).toBeNull();
  });

  test("reports queued and running production status", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const queued = requestDeployment(database, { projectId: project.id, ...manual });

    expect(getActiveRuntimeDeployment(database, project.id)).toEqual({
      id: queued.deploymentId,
      status: "queued",
    });
    transitionDeployment(database, queued.deploymentId, { to: "cloning" });
    expect(getActiveRuntimeDeployment(database, project.id)).toEqual({
      id: queued.deploymentId,
      status: "cloning",
    });
  });
});

describe("getActiveRuntimeDeployment terminal outcomes", () => {
  test.each(["failed", "cancelled", "succeeded"] as const)(
    "does not hold pending changes after %s",
    (status) => {
      const database = openMemoryDatabase();
      const project = createTestProject(database);
      const queued = requestDeployment(database, { projectId: project.id, ...manual });
      database
        .update(tables.deployments)
        .set({ status })
        .where(eq(tables.deployments.id, queued.deploymentId))
        .run();

      expect(getActiveRuntimeDeployment(database, project.id)).toBeNull();
    },
  );
});

describe("getActiveRuntimeDeployment isolation", () => {
  test("ignores deployments belonging to another project", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const other = createTestProject(database, { name: "Other", slug: "other" });
    requestDeployment(database, { projectId: other.id, ...manual });

    expect(getActiveRuntimeDeployment(database, project.id)).toBeNull();
  });

  test("ignores an active preview while production is idle", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const previewId = openPreview(database, {
      projectId: project.id,
      number: 12,
      branch: "feature/runtime",
      headSha: "a".repeat(40),
    });
    requestDeployment(database, { projectId: project.id, previewId, ...manual });

    expect(getActiveRuntimeDeployment(database, project.id)).toBeNull();
  });

  test("follows the newer queued deployment while an older one stops", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    const older = requestDeployment(database, { projectId: project.id, ...manual });
    transitionDeployment(database, older.deploymentId, { to: "cloning" });
    database
      .update(tables.deployments)
      .set({ createdAt: "2026-01-01T00:00:00Z" })
      .where(eq(tables.deployments.id, older.deploymentId))
      .run();
    const newer = requestDeployment(database, { projectId: project.id, ...manual });
    database
      .update(tables.deployments)
      .set({ createdAt: "2026-01-02T00:00:00Z" })
      .where(eq(tables.deployments.id, newer.deploymentId))
      .run();

    expect(getActiveRuntimeDeployment(database, project.id)).toEqual({
      id: newer.deploymentId,
      status: "queued",
    });
  });
});
