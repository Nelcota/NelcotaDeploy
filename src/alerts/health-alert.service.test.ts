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
    expect(problem?.title).toBe("Aplicação fora do ar");
  });

  test("reports a live application whose container is gone", () => {
    const [problem] = findHealthProblems({
      ...nothing,
      apps: [{ ...healthyApp, container: null }],
    });

    expect(problem?.title).toBe("Aplicação fora do ar");
  });

  test("reports an application in a restart loop", () => {
    const apps = [{ ...healthyApp, container: { state: "running", restartCount: 3 } }];

    const [problem] = findHealthProblems({ ...nothing, apps });

    expect(problem?.title).toBe("Aplicação reiniciando");
  });

  test("reports a database whose container is not running", () => {
    const databases = [
      { databaseId: "d1", projectName: "API", engineLabel: "PostgreSQL", containerRunning: false },
    ];

    const [problem] = findHealthProblems({ ...nothing, databases });

    expect(problem?.key).toBe("database:d1");
    expect(problem?.text).toBe("O PostgreSQL de API não está rodando.");
  });

  test("reports a disk at 85% or more", () => {
    const disks = [
      { serverId: "s1", serverName: "vps-1", usedBytes: 9 * GIBIBYTE, totalBytes: 10 * GIBIBYTE },
    ];

    const [problem] = findHealthProblems({ ...nothing, disks });

    expect(problem?.text).toBe("O disco de vps-1 está 90% ocupado.");
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
  const problem = { key: "app:p1", title: "Aplicação fora do ar", text: "O contêiner de API…" };

  test("opens a new problem once", () => {
    const database = openMemoryDatabase();

    const first = reconcileHealthAlerts(database, [problem], NOW);
    const second = reconcileHealthAlerts(database, [problem], NOW);

    expect(first.opened).toEqual([problem]);
    expect(second.opened).toEqual([]);
  });

  test("resolves a problem that is gone", () => {
    const database = openMemoryDatabase();
    reconcileHealthAlerts(database, [problem], NOW);

    const result = reconcileHealthAlerts(database, [], NOW);

    expect(result.resolved).toEqual([problem]);
    expect(reconcileHealthAlerts(database, [], NOW).resolved).toEqual([]);
  });
});
