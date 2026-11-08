import { describe, expect, test } from "bun:test";

import { type ServerMoveOption, serverMoveBlocker, serverMoveTarget } from "./server-move-state";

const current: ServerMoveOption = { id: "source", name: "Panel", status: "ready" };
const ready: ServerMoveOption = { id: "target", name: "Applications", status: "ready" };
const input = {
  projectId: "project",
  sourceServerId: current.id,
  choice: null,
  servers: [current, ready],
};
const choice = { projectId: "project", sourceServerId: current.id, targetId: ready.id };
const status = {
  volumeCount: 0,
  databaseCount: 0,
  currentDeploymentId: null,
  deploymentsApproved: true,
  activeDeployment: null,
};

describe("serverMoveTarget", () => {
  test("suggests the only ready alternative without selecting the source", () => {
    expect(serverMoveTarget(input)).toEqual({ server: ready, automatic: true });
  });

  test.each(
    [
      [],
      [current],
      [current, { ...ready, status: "pending" as const }],
      [current, ready, { ...ready, id: "other" }],
    ].map((servers) => ({ servers })),
  )("does not guess among unavailable or ambiguous choices %p", ({ servers }) => {
    expect(serverMoveTarget({ ...input, servers })).toEqual({ server: null, automatic: false });
  });

  test("requires a choice when multiple alternative servers are ready", () => {
    expect(
      serverMoveTarget({ ...input, servers: [current, ready, { ...ready, id: "other" }] }),
    ).toEqual({ server: null, automatic: false });
  });

  test("preserves a manual selection and marks a disconnected target as unavailable", () => {
    const disconnected = { ...ready, status: "unreachable" as const };

    expect(serverMoveTarget({ ...input, choice, servers: [current, disconnected] })).toEqual({
      server: disconnected,
      automatic: false,
    });
  });

  test("clears a selection belonging to an earlier source or project", () => {
    expect(
      serverMoveTarget({ ...input, choice: { ...choice, sourceServerId: "earlier" } }).server,
    ).toBeNull();
    expect(
      serverMoveTarget({ ...input, choice: { ...choice, projectId: "other" } }).server,
    ).toBeNull();
  });

  test("does not suggest moving back after a successful move cleared the selection", () => {
    expect(
      serverMoveTarget({
        ...input,
        sourceServerId: ready.id,
        choice: { ...choice, sourceServerId: ready.id, targetId: null },
      }),
    ).toEqual({ server: null, automatic: false });
  });

  test("does not keep a removed destination selected", () => {
    expect(serverMoveTarget({ ...input, choice, servers: [current] }).server).toBeNull();
  });
});

describe("serverMoveBlocker", () => {
  test("allows an undeployed project, even before deploy approval", () => {
    expect(serverMoveBlocker({ ...status, deploymentsApproved: false })).toBeNull();
  });
  test("detects volumes and databases, including detached local data", () => {
    expect(serverMoveBlocker({ ...status, volumeCount: 1 })).toBe("storage");
    expect(serverMoveBlocker({ ...status, databaseCount: 1 })).toBe("storage");
  });
  test("waits for an active production deployment", () => {
    expect(serverMoveBlocker({ ...status, activeDeployment: { id: "queued" } })).toBe("deployment");
  });
  test("requires approval before moving a deployed project", () => {
    expect(
      serverMoveBlocker({ ...status, currentDeploymentId: "live", deploymentsApproved: false }),
    ).toBe("approval");
  });
});
