import type { EnvironmentVariableView } from "@/environments";
import { pluralize } from "@/shared/format";
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

/**
 * Counts secrets and plain settings for the page description.
 *
 * @param variables - Every variable of the project.
 * @returns Text such as "1 secret, 3 configurações".
 */
export function describeKinds(variables: readonly EnvironmentVariableView[]): string {
  const secrets = variables.filter((variable) => variable.kind === "secret").length;
  const plain = variables.length - secrets;
  return `${pluralize(secrets, "secret", "secrets")}, ${pluralize(plain, "configuração", "configurações")}`;
}
