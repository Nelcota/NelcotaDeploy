import { describe, expect, test } from "bun:test";

import { databaseState, engineVersion } from "./database-state";

const RUNNING = { status: "running", errorMessage: null, deletionRequestedAt: null } as const;

describe("databaseState", () => {
  test("shows a running database as active", () => {
    const state = databaseState(RUNNING);

    expect(state.label).toBe("Ativo");
    expect(state.tone).toBe("success");
    expect(state.canDelete).toBe(true);
  });

  test("offers to retry a database that failed to start", () => {
    const state = databaseState({ ...RUNNING, status: "failed", errorMessage: "timeout" });

    expect(state.canRetry).toBe(true);
    expect(state.failureNote).toContain("Não foi possível iniciar");
  });

  test("offers no action while the database is being deleted", () => {
    const state = databaseState({ ...RUNNING, deletionRequestedAt: "2026-11-01T12:00:00Z" });

    expect(state.label).toBe("Excluindo…");
    expect(state.canDelete).toBe(false);
    expect(state.canRetry).toBe(false);
  });

  test("explains a deletion that failed", () => {
    const state = databaseState({ ...RUNNING, errorMessage: "volume in use" });

    expect(state.failureNote).toContain("Não foi possível excluir");
  });

  test("does not show the internal reason of a failure", () => {
    const state = databaseState({
      ...RUNNING,
      status: "failed",
      errorMessage: "docker run failed",
    });

    expect(state.failureNote).not.toContain("docker");
  });
});

describe("engineVersion", () => {
  test("keeps the version of a tag with a variant", () => {
    expect(engineVersion("postgres:18.6-alpine")).toBe("18.6");
  });

  test("keeps a three-part version", () => {
    expect(engineVersion("redis:8.10.3-alpine")).toBe("8.10.3");
  });

  test("returns the whole tag when it has no version", () => {
    expect(engineVersion("redis:latest")).toBe("latest");
  });
});
