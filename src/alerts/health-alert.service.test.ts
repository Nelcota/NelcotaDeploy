import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { findHealthProblems, reconcileHealthAlerts } from "./health-alert.service";

const GIBIBYTE = 1_073_741_824;
const NOW = new Date("2026-11-02T12:00:00Z");
const healthyApp = {
  projectId: "p1",
  projectName: "API",
  container: { state: "running", restartCount: 0 },
};
const nothing = { apps: [], databases: [], disks: [] };

describe("findHealthProblems", () => {
  test("finds nothing when everything runs", () => {
    expect(findHealthProblems({ ...nothing, apps: [healthyApp] })).toEqual([]);
  });

  test("reports a live application whose container stopped", () => {
    const apps = [{ ...healthyApp, container: { state: "exited", restartCount: 0 } }];

    const [problem] = findHealthProblems({ ...nothing, apps });

    expect(problem?.key).toBe("app:p1");
    expect(problem?.title).toBe("Application down");
  });

  test("reports a live application whose container is gone", () => {
    const [problem] = findHealthProblems({
      ...nothing,
      apps: [{ ...healthyApp, container: null }],
    });

    expect(problem?.title).toBe("Application down");
  });

  test("reports an application in a restart loop", () => {
    const apps = [{ ...healthyApp, container: { state: "running", restartCount: 3 } }];

    const [problem] = findHealthProblems({ ...nothing, apps });

    expect(problem?.title).toBe("Application restarting");
  });

  test("reports a database whose container is not running", () => {
    const databases = [
      { databaseId: "d1", projectName: "API", engineLabel: "PostgreSQL", containerRunning: false },
    ];

    const [problem] = findHealthProblems({ ...nothing, databases });

    expect(problem?.key).toBe("database:d1");
    expect(problem?.text).toBe("The PostgreSQL database for API is not running.");
  });

  test("reports a disk at 85% or more", () => {
    const disks = [
      { serverId: "s1", serverName: "vps-1", usedBytes: 9 * GIBIBYTE, totalBytes: 10 * GIBIBYTE },
    ];

    const [problem] = findHealthProblems({ ...nothing, disks });

    expect(problem?.text).toBe("Disk usage on vps-1 is at 90%.");
  });

  test("ignores a disk below 85%", () => {
    const disks = [
      { serverId: "s1", serverName: "vps-1", usedBytes: 8 * GIBIBYTE, totalBytes: 10 * GIBIBYTE },
    ];

    expect(findHealthProblems({ ...nothing, disks })).toEqual([]);
  });

  test("ignores a disk sample without totals", () => {
    const disks = [{ serverId: "s1", serverName: "vps-1", usedBytes: null, totalBytes: 0 }];

    expect(findHealthProblems({ ...nothing, disks })).toEqual([]);
  });
});

describe("reconcileHealthAlerts", () => {
  const problem = {
    key: "app:p1",
    title: "Application down",
    text: "The API container is not running.",
  };

  test("opens a new problem once", () => {
    const database = openMemoryDatabase();

    const first = reconcileHealthAlerts(database, [problem], { now: NOW });
    const second = reconcileHealthAlerts(database, [problem], { now: NOW });

    expect(first.opened).toEqual([problem]);
    expect(second.opened).toEqual([]);
  });

  test("resolves a problem that is gone", () => {
    const database = openMemoryDatabase();
    reconcileHealthAlerts(database, [problem], { now: NOW });

    const result = reconcileHealthAlerts(database, [], { now: NOW });

    expect(result.resolved).toEqual([problem]);
    expect(reconcileHealthAlerts(database, [], { now: NOW }).resolved).toEqual([]);
  });

  test("keeps an unchecked problem open until a later check confirms recovery", () => {
    const database = openMemoryDatabase();
    reconcileHealthAlerts(database, [problem], { now: NOW });

    const skipped = reconcileHealthAlerts(database, [], {
      now: NOW,
      uncheckedKeys: new Set([problem.key]),
    });
    const stillDown = reconcileHealthAlerts(database, [problem], { now: NOW });
    const recovered = reconcileHealthAlerts(database, [], { now: NOW });

    expect(skipped.resolved).toEqual([]);
    expect(stillDown.opened).toEqual([]);
    expect(recovered.resolved).toEqual([problem]);
  });
});
