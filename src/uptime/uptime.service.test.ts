import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import type { ProbeResult } from "./uptime-probe";
import {
  listUptimeSummaries,
  nextState,
  pruneUptimeChecks,
  recordUptimeCheck,
  retainUptimeHostnames,
} from "./uptime.service";

const NOW = new Date("2026-11-02T12:00:00Z");
const MINUTE_IN_MS = 60_000;
const UP: ProbeResult = {
  kind: "checked",
  up: true,
  statusCode: 200,
  responseTimeInMs: 80,
  reason: null,
};
const DOWN: ProbeResult = {
  kind: "checked",
  up: false,
  statusCode: null,
  responseTimeInMs: null,
  reason: "timeout",
};

function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const target = { projectId: project.id, hostname: "api.example.com" };
  let minute = 0;
  const record = (result: ProbeResult) => {
    minute += 1;
    return recordUptimeCheck(database, {
      target,
      result,
      checkedAt: new Date(NOW.getTime() - (10 - minute) * MINUTE_IN_MS),
    });
  };
  return { database, project, target, record };
}

describe("nextState", () => {
  test("keeps the last state after a single failure", () => {
    expect(nextState({ status: "up", consecutiveFailures: 0 }, DOWN)).toEqual({
      status: "up",
      consecutiveFailures: 1,
    });
  });

  test("goes down after two failures in a row", () => {
    expect(nextState({ status: "up", consecutiveFailures: 1 }, DOWN)).toEqual({
      status: "down",
      consecutiveFailures: 2,
    });
  });

  test("comes back up on the first success", () => {
    expect(nextState({ status: "down", consecutiveFailures: 5 }, UP)).toEqual({
      status: "up",
      consecutiveFailures: 0,
    });
  });

  test("marks a hostname on a private address as such", () => {
    expect(nextState({ status: "up", consecutiveFailures: 0 }, { kind: "private" })).toEqual({
      status: "private",
      consecutiveFailures: 0,
    });
  });
});

describe("recordUptimeCheck", () => {
  test("says the hostname went down on the second failure only", () => {
    const { record } = setup();
    record(UP);

    const first = record(DOWN);
    const second = record(DOWN);
    const third = record(DOWN);

    expect([first, second, third]).toEqual([null, "went-down", null]);
  });

  test("says the hostname recovered when it answers again", () => {
    const { record } = setup();
    record(DOWN);
    record(DOWN);

    expect(record(UP)).toBe("recovered");
  });

  test("says nothing when a new hostname answers", () => {
    const { record } = setup();

    expect(record(UP)).toBeNull();
  });

  test("stores no check for a hostname on a private address", () => {
    const { database, record } = setup();

    record({ kind: "private" });

    expect(database.select().from(tables.uptimeChecks).all()).toEqual([]);
  });
});

describe("listUptimeSummaries", () => {
  test("reports availability, the last response time and the recent checks", () => {
    const { database, project, record } = setup();
    record(UP);
    record(UP);
    record(DOWN);
    record(UP);

    const [summary] = listUptimeSummaries(database, project.id, NOW);

    expect(summary).toMatchObject({
      hostname: "api.example.com",
      status: "up",
      uptimeLastDayPercent: 75,
      uptimeLastWeekPercent: 75,
      lastResponseTimeInMs: 80,
      lastReason: null,
    });
    expect(summary?.recent.map((check) => check.up)).toEqual([true, true, false, true]);
    expect(summary?.recent.map((check) => check.reason)).toEqual([null, null, "timeout", null]);
  });

  test("returns nothing for a project whose hostnames were never checked", () => {
    const { database, project } = setup();

    expect(listUptimeSummaries(database, project.id, NOW)).toEqual([]);
  });
});

describe("retainUptimeHostnames", () => {
  test("forgets hostnames no longer routed", () => {
    const { database, project, record } = setup();
    record(UP);

    retainUptimeHostnames(database, ["other.example.com"]);

    expect(listUptimeSummaries(database, project.id, NOW)).toEqual([]);
  });
});

describe("pruneUptimeChecks", () => {
  test("deletes checks older than a week", () => {
    const { database, target } = setup();
    recordUptimeCheck(database, {
      target,
      result: UP,
      checkedAt: new Date(NOW.getTime() - 8 * 24 * 60 * MINUTE_IN_MS),
    });

    pruneUptimeChecks(database, NOW);

    expect(database.select().from(tables.uptimeChecks).all()).toEqual([]);
  });
});
