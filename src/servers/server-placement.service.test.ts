import { describe, expect, test } from "bun:test";

import { type Database, openMemoryDatabase } from "@/db";
import { createTestProject, TEST_ACTOR } from "@/testing";

import {
  applicationServersReady,
  chooseServerForNewProject,
  dedicatePanelHostIfUnused,
} from "./server-placement.service";
import { NoServerAvailableError } from "./server.errors";
import {
  addServer,
  getServer,
  LOCAL_SERVER_ID,
  recordServerCheck,
  setServerAcceptsApplications,
} from "./server.service";

function addRemote(database: Database): string {
  return addServer(database, {
    input: { name: "apps-1", host: "203.0.113.10", port: 22, username: "nelcota" },
    actor: TEST_ACTOR,
  }).id;
}

function markReady(database: Database, serverId: string): void {
  recordServerCheck(database, serverId, { status: "ready", message: null, dockerVersion: "29" });
}

describe("chooseServerForNewProject", () => {
  test("uses the panel's host while it is the only server", () => {
    const database = openMemoryDatabase();

    expect(chooseServerForNewProject(database)).toBe(LOCAL_SERVER_ID);
  });

  test("prefers a ready server over a pending one", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);
    markReady(database, remote);

    expect(chooseServerForNewProject(database)).toBe(remote);
  });

  test("prefers the ready server running fewer projects", () => {
    const database = openMemoryDatabase();
    markReady(database, LOCAL_SERVER_ID);
    markReady(database, addRemote(database));
    const busy = createTestProject(database).serverId;

    const chosen = chooseServerForNewProject(database);

    expect(chosen).not.toBe(busy);
  });

  test("throws NoServerAvailableError when every server refuses new applications", () => {
    const database = openMemoryDatabase();
    setServerAcceptsApplications(database, {
      serverId: LOCAL_SERVER_ID,
      acceptsApplications: false,
      actor: TEST_ACTOR,
    });

    expect(() => chooseServerForNewProject(database)).toThrow(NoServerAvailableError);
  });
});

describe("dedicatePanelHostIfUnused", () => {
  test("stops placing projects on the panel's host when the first other server is ready", () => {
    const database = openMemoryDatabase();
    markReady(database, addRemote(database));

    const dedicated = dedicatePanelHostIfUnused(database);

    expect(dedicated).toBe(true);
    expect(getServer(database, LOCAL_SERVER_ID).acceptsApplications).toBe(false);
  });

  test("keeps the panel's host open while projects run on it", () => {
    const database = openMemoryDatabase();
    createTestProject(database);
    markReady(database, addRemote(database));

    expect(dedicatePanelHostIfUnused(database)).toBe(false);
    expect(getServer(database, LOCAL_SERVER_ID).acceptsApplications).toBe(true);
  });

  test("does nothing while no other server is ready", () => {
    const database = openMemoryDatabase();
    addRemote(database);

    expect(dedicatePanelHostIfUnused(database)).toBe(false);
  });
});

describe("applicationServersReady", () => {
  test("is true when the panel's host is ready and runs the applications", () => {
    const database = openMemoryDatabase();
    markReady(database, LOCAL_SERVER_ID);

    expect(applicationServersReady(database)).toBe(true);
  });

  test("ignores a server just added that waits for its install command", () => {
    const database = openMemoryDatabase();
    markReady(database, LOCAL_SERVER_ID);
    addRemote(database);

    expect(applicationServersReady(database)).toBe(true);
  });

  test("is false when a server that holds a project becomes unreachable", () => {
    const database = openMemoryDatabase();
    markReady(database, LOCAL_SERVER_ID);
    createTestProject(database);
    recordServerCheck(database, LOCAL_SERVER_ID, {
      status: "unreachable",
      message: "timeout",
      dockerVersion: null,
    });

    expect(applicationServersReady(database)).toBe(false);
  });
});
