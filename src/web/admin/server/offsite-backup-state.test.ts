import { describe, expect, test } from "bun:test";

import { offsiteBackupState } from "./offsite-backup-state";

const NOW = new Date("2026-10-29T12:00:00Z");

describe("offsiteBackupState", () => {
  test("asks for a bucket when none is configured", () => {
    expect(offsiteBackupState({ configured: false, status: null }, NOW)).toEqual({
      tone: "warning",
      label: "Desativada",
    });
  });

  test("waits for the first backup", () => {
    expect(offsiteBackupState({ configured: true, status: null }, NOW).tone).toBe("neutral");
  });

  test("shows a failure even after an earlier success", () => {
    const state = offsiteBackupState(
      {
        configured: true,
        status: {
          attemptedAt: "2026-10-29T03:30:00Z",
          uploadedAt: "2026-10-28T03:30:00Z",
          error: "timeout",
        },
      },
      NOW,
    );

    expect(state.tone).toBe("danger");
    expect(state.label).toStartWith("Falhou");
  });

  test("shows when the last copy was sent", () => {
    const state = offsiteBackupState(
      {
        configured: true,
        status: {
          attemptedAt: "2026-10-29T03:30:00Z",
          uploadedAt: "2026-10-29T03:30:00Z",
          error: null,
        },
      },
      NOW,
    );

    expect(state).toMatchObject({ tone: "success" });
    expect(state.label).toStartWith("Enviada");
  });
});
