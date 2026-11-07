import { expect, test } from "bun:test";

import type { EnvironmentVariableView } from "@/environments";

import { variableFormSchema } from "./variable-form.schema";

const draft = {
  key: "AUTH_SECRET",
  kind: "secret",
  value: "",
  availableAtBuild: false,
  excludeFromPreviews: true,
} as const;
const variable: EnvironmentVariableView = {
  id: "saved",
  key: "AUTH_SECRET",
  kind: "secret",
  value: null,
  availableAtBuild: false,
  excludeFromPreviews: true,
  updatedAt: "2026-11-06T12:00:00Z",
};

test("requires an explicit value for a new secret", () => {
  expect(variableFormSchema(null, []).safeParse(draft).success).toBe(false);
  expect(
    variableFormSchema(null, []).safeParse({ ...draft, value: "generated-secret" }).success,
  ).toBe(true);
});

test("keeps a saved secret when its value is left blank", () => {
  expect(variableFormSchema(variable, [variable.key]).safeParse(draft).success).toBe(true);
});

test("requires a value when converting a plain variable to a secret", () => {
  expect(
    variableFormSchema({ ...variable, kind: "plain", value: "public" }, [variable.key]).safeParse(
      draft,
    ).success,
  ).toBe(false);
});

test("prevents new drafts from replacing an existing variable", () => {
  const result = variableFormSchema(null, [draft.key]).safeParse({
    ...draft,
    value: "another-secret",
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues.at(0)?.path).toEqual(["key"]);
});
