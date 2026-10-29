import { describe, expect, test } from "bun:test";

import { volumeState } from "./volume-state";

const ATTACHED = { attached: true, deletionRequestedAt: null, deletionError: null };

describe("volumeState", () => {
  test("lets an attached volume be detached but not wiped", () => {
    const state = volumeState(ATTACHED);

    expect(state).toMatchObject({ label: "Montado", canToggle: true, canDeleteData: false });
  });

  test("offers to delete the data of a detached volume", () => {
    const state = volumeState({ ...ATTACHED, attached: false });

    expect(state).toMatchObject({ label: "Desanexado", canDeleteData: true });
  });

  test("blocks every action while the data is being deleted", () => {
    const state = volumeState({
      ...ATTACHED,
      attached: false,
      deletionRequestedAt: "2026-10-29T12:00:00Z",
    });

    expect(state).toMatchObject({ canToggle: false, canDeleteData: false, tone: "warning" });
  });

  test("explains a failed deletion in Portuguese instead of the Docker error", () => {
    const state = volumeState({ ...ATTACHED, attached: false, deletionError: "volume is in use" });

    expect(state.failureNote).toStartWith("Não foi possível apagar os dados.");
    expect(state.failureNote).not.toContain("in use");
  });
});
