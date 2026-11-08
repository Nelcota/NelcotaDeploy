import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { requestDeployment, transitionDeployment } from "@/deployments";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { appendDeploymentLogs, appendRuntimeLogs, listRuntimeLogs, pruneLogs } from "./log.service";

const CREATED_AT = "2026-10-28T12:00:00.000Z";
// Above the 8192 characters the service keeps per line.
const LONG_LINE_LENGTH = 16_384;

test("enforces runtime retention during ingestion and resumes through the deployment index", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const line = {
    projectId: project.id,
    deploymentId: "deployment",
    stream: "stdout" as const,
    createdAt: CREATED_AT,
  };
  appendRuntimeLogs(
    database,
    Array.from({ length: 5 }, (_, index) => ({ ...line, message: String(index) })),
    2,
  );
  expect(
    listRuntimeLogs(database, project.id, { limit: 10 }).map((entry) => entry.message),
  ).toEqual(["3", "4"]);
  const plan = database.$client
    .query<{ detail: string }, [string]>(
      "EXPLAIN QUERY PLAN SELECT created_at FROM runtime_logs WHERE deployment_id = ? ORDER BY id DESC LIMIT 1",
    )
    .all("deployment");
  expect(plan.some((step) => step.detail.includes("runtime_logs_deployment_id_idx"))).toBe(true);
});

describe("appendRuntimeLogs", () => {
  test("stores lines without terminal color codes", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    appendRuntimeLogs(database, [
      {
        projectId: project.id,
        deploymentId: null,
        stream: "stdout",
        message: "\u001b[32mINFO\u001b[0m server listening on \u001b[1m3000\u001b[22m",
        createdAt: CREATED_AT,
      },
    ]);

    const [line] = listRuntimeLogs(database, project.id, { limit: 10 });
    expect(line?.message).toBe("INFO server listening on 3000");
  });

  test("cuts lines longer than the limit", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    appendRuntimeLogs(database, [
      {
        projectId: project.id,
        deploymentId: null,
        stream: "stdout",
        message: "a".repeat(LONG_LINE_LENGTH),
        createdAt: CREATED_AT,
      },
    ]);

    const [line] = listRuntimeLogs(database, project.id, { limit: 10 });
    expect(line?.message.endsWith("…")).toBe(true);
  });
});

test("retains the newest lines per project with interleaved ids and counts both deletions", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const first = createTestProject(database);
  const second = createTestProject(database, { name: "Second", slug: "second" });
  const sparse = createTestProject(database, { name: "Sparse", slug: "sparse" });
  appendRuntimeLogs(
    database,
    [first, second, first, sparse, second, first, second].map((project, index) => ({
      projectId: project.id,
      deploymentId: null,
      stream: "stdout",
      message: String(index),
      createdAt: CREATED_AT,
    })),
  );
  const deployment = requestDeployment(database, {
    projectId: first.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  appendDeploymentLogs(database, deployment.deploymentId, [
    { stream: "system", level: "info", message: "Old build" },
  ]);
  transitionDeployment(database, deployment.deploymentId, {
    to: "failed",
  });
  database
    .update(tables.deployments)
    .set({ finishedAt: CREATED_AT })
    .where(eq(tables.deployments.id, deployment.deploymentId))
    .run();

  const counts = pruneLogs(database, {
    runtimeLinesPerProject: 2,
    deploymentLogRetentionDays: 1,
    now: new Date("2026-11-06T12:00:00.000Z"),
  });

  expect(counts).toEqual({ runtime: 2, deployment: 1 });
  expect(listRuntimeLogs(database, first.id, { limit: 10 }).map((line) => line.message)).toEqual([
    "2",
    "5",
  ]);
  expect(listRuntimeLogs(database, second.id, { limit: 10 }).map((line) => line.message)).toEqual([
    "4",
    "6",
  ]);
  expect(listRuntimeLogs(database, sparse.id, { limit: 10 }).map((line) => line.message)).toEqual([
    "3",
  ]);
  expect(database.select().from(tables.deploymentLogs).all()).toEqual([]);
  expect(
    pruneLogs(database, {
      runtimeLinesPerProject: 2,
      deploymentLogRetentionDays: 1,
      now: new Date("2026-11-06T12:00:00.000Z"),
    }),
  ).toEqual({ runtime: 0, deployment: 0 });
});
