import { describe, expect, test } from "bun:test";

import type { EnvironmentVariableView } from "@/environments";

import { draftFromVariable } from "./variable-draft";

function variable(overrides: Partial<EnvironmentVariableView>): EnvironmentVariableView {
  return {
    id: "variable-1",
    key: "NODE_ENV",
    kind: "plain",
    value: "production",
    availableAtBuild: false,
    excludeFromPreviews: false,
    updatedAt: "2026-10-28T12:00:00Z",
    ...overrides,
  };
}

describe("draftFromVariable", () => {
  test("returns an empty plain draft for a new variable", () => {
    const draft = draftFromVariable(null);

    expect(draft).toEqual({
      key: "",
      kind: "plain",
      value: "",
      availableAtBuild: false,
      excludeFromPreviews: false,
    });
  });

  test("copies the saved fields of a plain variable", () => {
    const draft = draftFromVariable(
      variable({ availableAtBuild: true, excludeFromPreviews: true }),
    );

    expect(draft).toEqual({
      key: "NODE_ENV",
      kind: "plain",
      value: "production",
      availableAtBuild: true,
      excludeFromPreviews: true,
    });
  });

  test("starts a secret with an empty value", () => {
    const draft = draftFromVariable(variable({ kind: "secret", value: null }));

    expect(draft.value).toBe("");
  });
});
