import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { ServerInUseError, ServerTakenError } from "./server.errors";
import {
  addServer,
  getServer,
  LOCAL_SERVER_ID,
  recordServerCheck,
  removeServer,
} from "./server.service";

function addRemote(database: Database, name = "apps-1", host = "203.0.113.10"): string {
  return addServer(database, {
    input: { name, host, port: 22, username: "nelcota" },
    actor: TEST_ACTOR,
  }).id;
}

function markReady(database: Database, serverId: string): void {
  recordServerCheck(database, serverId, { status: "ready", message: null, dockerVersion: "29" });
}

describe("addServer", () => {
  test("registers a pending server reached over SSH", () => {
    const database = openMemoryDatabase();

    const server = getServer(database, addRemote(database));

    expect(server.kind).toBe("ssh");
    expect(server.status).toBe("pending");
    expect(server.acceptsApplications).toBe(true);
  });

  test("throws ServerTakenError for a name already in use", () => {
    const database = openMemoryDatabase();
    addRemote(database, "apps");

    expect(() => addRemote(database, "apps", "203.0.113.11")).toThrow(ServerTakenError);
  });

  test("throws ServerTakenError for an address and port already in use", () => {
    const database = openMemoryDatabase();
    addRemote(database, "apps-1");

    expect(() => addRemote(database, "apps-2")).toThrow(ServerTakenError);
  });
});

describe("recordServerCheck", () => {
  test("pins the first host key and keeps it on later checks", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);

    recordServerCheck(database, remote, {
      status: "ready",
      message: null,
      dockerVersion: "29",
      hostKeyFingerprint: "SHA256:first",
    });
    recordServerCheck(database, remote, {
      status: "ready",
      message: null,
      dockerVersion: "29",
      hostKeyFingerprint: "SHA256:second",
    });

    expect(getServer(database, remote).hostKeyFingerprint).toBe("SHA256:first");
  });

  test("keeps the last time the server was seen when it becomes unreachable", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);
    markReady(database, remote);
    const seenAt = getServer(database, remote).lastSeenAt;

    recordServerCheck(database, remote, {
      status: "unreachable",
      message: "timeout",
      dockerVersion: null,
    });

    expect(getServer(database, remote).lastSeenAt).toBe(seenAt);
    expect(getServer(database, remote).status).toBe("unreachable");
  });
});

describe("removeServer", () => {
  test("removes a server without projects", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);

    removeServer(database, { serverId: remote, actor: TEST_ACTOR });

    const rows = database.select().from(tables.servers).where(eq(tables.servers.id, remote)).all();
    expect(rows).toEqual([]);
  });

  test("throws ServerInUseError for the panel's own host", () => {
    const database = openMemoryDatabase();

    const remove = () => removeServer(database, { serverId: LOCAL_SERVER_ID, actor: TEST_ACTOR });

    expect(remove).toThrow(ServerInUseError);
  });

  test("throws ServerInUseError while a project is placed on the server", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);
    const project = createTestProject(database);
    database
      .update(tables.projects)
      .set({ serverId: remote })
      .where(eq(tables.projects.id, project.id))
      .run();

    const remove = () => removeServer(database, { serverId: remote, actor: TEST_ACTOR });

    expect(remove).toThrow(ServerInUseError);
  });
});

describe("removeServer with leftovers", () => {
  test("throws ServerInUseError while a moved project's old container still runs on it", () => {
    const database = openMemoryDatabase();
    const remote = addRemote(database);
    const project = createTestProject(database);
    database
      .insert(tables.containerSnapshots)
      .values({
        containerId: "old",
        serverId: remote,
        projectId: project.id,
        name: "nelcota-api-old",
        image: "nelcota/api:old",
        state: "running",
        observedAt: new Date().toISOString(),
      })
      .run();

    const remove = () => removeServer(database, { serverId: remote, actor: TEST_ACTOR });

    expect(remove).toThrow(ServerInUseError);
  });
});
