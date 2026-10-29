import type { EnvironmentVariableView } from "@/environments";
import type { VariableKind } from "@/web/components/forms/env-kind-toggle";

/** Shown in place of a secret, which never comes back to the browser. */
export const MASKED_VALUE = "••••••";

export type VariableDraft = {
  readonly key: string;
  readonly kind: VariableKind;
  readonly value: string;
  readonly availableAtBuild: boolean;
};

const EMPTY_DRAFT: VariableDraft = { key: "", kind: "plain", value: "", availableAtBuild: false };

/**
 * Starting values of the variable form: empty for a new variable, the saved fields otherwise.
 *
 * @param variable - Variable being edited, or null to create one.
 * @returns The draft; a secret starts with an empty value because the browser never sees it.
 */
export function draftFromVariable(variable: EnvironmentVariableView | null): VariableDraft {
  if (variable == null) {
    return EMPTY_DRAFT;
  }
  return {
    key: variable.key,
    kind: variable.kind,
    value: variable.value ?? "",
    availableAtBuild: variable.availableAtBuild,
  };
}
