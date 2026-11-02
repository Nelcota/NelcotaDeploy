import { describe, expect, test } from "bun:test";

import { backupState } from "./backup-state";

const SUCCEEDED = { status: "succeeded", restoredAt: null, restoreError: null } as const;

describe("backupState", () => {
  test("lets a successful backup be restored", () => {
    const state = backupState(SUCCEEDED);

    expect(state.label).toBe("Concluído");
    expect(state.canRestore).toBe(true);
  });

  test("does not let a failed backup be restored", () => {
    expect(backupState({ ...SUCCEEDED, status: "failed" }).canRestore).toBe(false);
  });

  test("does not let a backup in progress be restored", () => {
    expect(backupState({ ...SUCCEEDED, status: "running" }).canRestore).toBe(false);
  });

  test("warns about a restore that failed without showing its internal reason", () => {
    const state = backupState({ ...SUCCEEDED, restoreError: "pg_restore: error" });

    expect(state.restoreNote).toContain("A última restauração falhou");
    expect(state.restoreNote).not.toContain("pg_restore");
  });
});
