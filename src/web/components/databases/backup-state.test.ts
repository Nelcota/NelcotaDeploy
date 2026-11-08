import { describe, expect, test } from "bun:test";

import { backupRefreshInterval, backupState, isBackupPending } from "./backup-state";

const SUCCEEDED = {
  status: "succeeded",
  restoredAt: null,
  restoreError: null,
  restorePending: false,
} as const;

describe("backupState", () => {
  test("shows a pending restore and disables a second restore", () => {
    const state = backupState({
      ...SUCCEEDED,
      restorePending: true,
      restoreError: "previous failure",
    });

    expect(state.label).toBe("Restaurando…");
    expect(state.canRestore).toBe(false);
    expect(state.restoreNote).toBeNull();
  });
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

test.each([
  ["queued", false, true],
  ["running", false, true],
  ["succeeded", true, true],
  ["succeeded", false, false],
  ["failed", false, false],
] as const)(
  "detects status %s with restorePending=%p as pending=%p",
  (status, restorePending, expected) => {
    expect(isBackupPending({ status, restorePending })).toBe(expected);
  },
);

describe("backupRefreshInterval", () => {
  test("discovers the first scheduled backup while the list is empty", () => {
    expect(backupRefreshInterval([])).toBe(15_000);
  });

  test("keeps checking after previous backups finished", () => {
    expect(backupRefreshInterval([SUCCEEDED, { ...SUCCEEDED, status: "failed" }])).toBe(15_000);
  });

  test.each(["queued", "running"] as const)("follows a %s backup more frequently", (status) => {
    expect(backupRefreshInterval([SUCCEEDED, { ...SUCCEEDED, status }])).toBe(3000);
  });

  test("follows a restore while its backup remains succeeded", () => {
    expect(backupRefreshInterval([{ ...SUCCEEDED, restorePending: true }])).toBe(3000);
  });
});
