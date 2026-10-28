import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import { summarizeDeployments } from "./deployment-stats.service";

// 12:00 in São Paulo on Wednesday, 28 October 2026.
const NOW = new Date("2026-10-28T15:00:00Z");

function insertDeployment(
  database: Database,
  projectId: string,
  values: {
    readonly status: (typeof tables.deployments.$inferInsert)["status"];
    readonly createdAt: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
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
      startedAt: values.startedAt ?? null,
      finishedAt: values.finishedAt ?? null,
    })
    .run();
}

function setup(): { database: Database; projectId: string } {
  const database = openMemoryDatabase();
  return { database, projectId: createTestProject(database).id };
}

describe("summarizeDeployments", () => {
  test("counts deploys by outcome inside the window", () => {
    const { database, projectId } = setup();
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T14:00:00Z",
    });
    insertDeployment(database, projectId, { status: "failed", createdAt: "2026-10-27T14:00:00Z" });
    insertDeployment(database, projectId, {
      status: "cancelled",
      createdAt: "2026-10-26T14:00:00Z",
    });

    const stats = summarizeDeployments(database, { days: 7, now: NOW });

    expect(stats).toMatchObject({ total: 3, succeeded: 1, failed: 1, cancelled: 1 });
  });

  test("ignores deploys from before the first day of the window", () => {
    const { database, projectId } = setup();
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-21T14:00:00Z",
    });

    const stats = summarizeDeployments(database, { days: 7, now: NOW });

    expect(stats.total).toBe(0);
  });

  test("returns one entry per day, oldest first, including empty days", () => {
    const { database, projectId } = setup();
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T14:00:00Z",
    });

    const stats = summarizeDeployments(database, { days: 3, now: NOW });

    expect(stats.days).toEqual([
      { day: "2026-10-26", succeeded: 0, failed: 0, other: 0 },
      { day: "2026-10-27", succeeded: 0, failed: 0, other: 0 },
      { day: "2026-10-28", succeeded: 1, failed: 0, other: 0 },
    ]);
  });

  test("places a deploy on its São Paulo calendar day", () => {
    const { database, projectId } = setup();
    // 01:00 UTC on the 28th is 22:00 on the 27th in São Paulo.
    insertDeployment(database, projectId, { status: "failed", createdAt: "2026-10-28T01:00:00Z" });

    const stats = summarizeDeployments(database, { days: 2, now: NOW });

    expect(stats.days.at(0)).toEqual({ day: "2026-10-27", succeeded: 0, failed: 1, other: 0 });
  });

  test("computes the success rate over finished deploys only", () => {
    const { database, projectId } = setup();
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T10:00:00Z",
    });
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T11:00:00Z",
    });
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T12:00:00Z",
    });
    insertDeployment(database, projectId, { status: "failed", createdAt: "2026-10-28T13:00:00Z" });
    insertDeployment(database, projectId, { status: "queued", createdAt: "2026-10-28T14:00:00Z" });

    const stats = summarizeDeployments(database, { days: 7, now: NOW });

    expect(stats.successRatePercent).toBe(75);
  });

  test("averages the duration of succeeded deploys", () => {
    const { database, projectId } = setup();
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T10:00:00Z",
      startedAt: "2026-10-28T10:00:00Z",
      finishedAt: "2026-10-28T10:00:10Z",
    });
    insertDeployment(database, projectId, {
      status: "succeeded",
      createdAt: "2026-10-28T11:00:00Z",
      startedAt: "2026-10-28T11:00:00Z",
      finishedAt: "2026-10-28T11:00:30Z",
    });

    const stats = summarizeDeployments(database, { days: 7, now: NOW });

    expect(stats.averageDurationInMs).toBe(20_000);
  });

  test("returns null rate and duration when nothing finished", () => {
    const { database } = setup();

    const stats = summarizeDeployments(database, { days: 7, now: NOW });

    expect(stats).toMatchObject({ total: 0, successRatePercent: null, averageDurationInMs: null });
  });

  test("throws RangeError when days is zero", () => {
    const { database } = setup();

    expect(() => summarizeDeployments(database, { days: 0, now: NOW })).toThrow(RangeError);
  });

  test("throws RangeError when days is above 30", () => {
    const { database } = setup();

    expect(() => summarizeDeployments(database, { days: 31, now: NOW })).toThrow(RangeError);
  });

  test("throws RangeError when days is not an integer", () => {
    const { database } = setup();

    expect(() => summarizeDeployments(database, { days: 1.5, now: NOW })).toThrow(RangeError);
  });
});
