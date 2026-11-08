import type { EnvironmentVariableView } from "@/environments";
import type { DotenvEntry } from "@/shared/dotenv";
import { suggestedVariableKind } from "@/shared/schemas/environment/environment-import.schema";

import {
  generateApplicationSecret,
  isApplicationSecretKey,
  isApplicationUrlKey,
} from "../variable-defaults";
const PLACEHOLDER_VALUE =
  /\$\{|\$\(|<[^>]+>|^(?:change[-_]?me|replace[-_]?me|your[-_].*|xxx+|todo)$/i;

export type TemplateVariableDraft = {
  readonly key: string;
  readonly value: string;
  readonly kind: "plain" | "secret";
  readonly selected: boolean;
  readonly generated: boolean;
};
export type TemplateEntry = DotenvEntry & { readonly kind?: "plain" | "secret" };

/** Fills missing configuration while preserving every existing value, including masked secrets. */
export function createTemplateDraft(
  entries: readonly TemplateEntry[],
  options: {
    readonly variables: readonly EnvironmentVariableView[];
    readonly applicationUrl: string | null;
  },
): TemplateVariableDraft[] {
  const existing = new Set(options.variables.map((variable) => variable.key));
  return entries
    .filter((entry) => existing.has(entry.key) === false)
    .map((entry) => {
      const kind = entry.kind ?? suggestedVariableKind(entry.key, entry.value);
      const generated = isApplicationSecretKey(entry.key);
      if (generated) {
        return {
          key: entry.key,
          kind: "secret",
          value: generateApplicationSecret(),
          generated,
          selected: true,
        };
      }
      if (kind === "secret") {
        return { key: entry.key, kind, value: "", generated, selected: true };
      }
      const value =
        isApplicationUrlKey(entry.key) && options.applicationUrl != null
          ? options.applicationUrl
          : entry.value;
      return {
        key: entry.key,
        kind,
        value: PLACEHOLDER_VALUE.test(value) ? "" : value,
        generated,
        selected: true,
      };
    });
}
