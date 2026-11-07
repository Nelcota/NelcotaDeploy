import { useStore } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";

import { suggestedVariableKind } from "@/shared/schemas/environment/environment-import.schema";

import {
  generateApplicationSecret,
  isApplicationSecretKey,
  isApplicationUrlKey,
} from "../variable-defaults";
import type { VariableFormApi } from "./use-variable-form";
import { parseVariableAssignment } from "./variable-assignment";

type AutomaticField = "value" | "kind" | "excludeFromPreviews";

/** Fills new drafts only; saved variables and explicitly customized fields keep their values. */
export function useVariableAutomation(
  form: VariableFormApi,
  options: {
    readonly editing: boolean;
    readonly applicationUrl: string | null;
    readonly existingKeys: readonly string[];
  },
) {
  const [manualFields, setManualFields] = useState<ReadonlySet<AutomaticField>>(() => new Set());
  const generatedSecrets = useRef(new Map<string, string>());
  const key = useStore(form.store, (state) => state.values.key);
  const value = useStore(form.store, (state) => state.values.value);
  const kind = useStore(form.store, (state) => state.values.kind);
  const previews = useStore(form.store, (state) => state.values.excludeFromPreviews);
  const existing = options.editing || options.existingKeys.includes(key);
  const { applicationUrl } = options;

  useEffect(() => {
    if (existing || manualFields.has("value")) {
      return;
    }
    let automaticValue = "";
    if (isApplicationSecretKey(key)) {
      automaticValue = generatedSecrets.current.get(key) ?? generateApplicationSecret();
      generatedSecrets.current.set(key, automaticValue);
    }
    if (isApplicationUrlKey(key)) {
      automaticValue = applicationUrl ?? "";
    }
    form.setFieldValue("value", automaticValue);
  }, [form, key, existing, applicationUrl, manualFields]);

  useEffect(() => {
    if (existing || manualFields.has("kind")) {
      return;
    }
    const suggested = suggestedVariableKind(key, value);
    if (suggested !== kind) {
      form.setFieldValue("kind", suggested);
    }
  }, [form, existing, key, value, kind, manualFields]);

  useEffect(() => {
    if (existing || manualFields.has("excludeFromPreviews")) {
      return;
    }
    const excluded = kind === "secret";
    if (excluded !== previews) {
      form.setFieldValue("excludeFromPreviews", excluded);
    }
  }, [form, existing, kind, previews, manualFields]);

  const markEdited = (field: AutomaticField) =>
    setManualFields((current) => current.union(new Set([field])));
  const pasteAssignment = (text: string): boolean => {
    const entry = parseVariableAssignment(text);
    if (options.editing || entry == null) {
      return false;
    }
    markEdited("value");
    form.setFieldValue("key", entry.key);
    form.setFieldValue("value", entry.value);
    return true;
  };
  return { markEdited, pasteAssignment };
}
