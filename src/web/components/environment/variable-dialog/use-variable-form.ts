import { useForm } from "@tanstack/react-form";
import type { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import type { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";
import { useAction } from "@/web/components/layout/use-action";
import { saveEnvironmentVariableFn } from "@/web/functions/environment.functions";

import { draftFromVariable } from "../variable-draft";
import { variableFormSchema } from "./variable-form.schema";

/**
 * Form state and save action of the variable dialog.
 *
 * @param options - Project, variable being edited (null for a new one) and what to do after saving.
 * @returns The form and the save action, whose `isPending` drives the submit button.
 */
export function useVariableForm({
  projectId,
  variable,
  existingKeys,
  onSaved,
}: {
  readonly projectId: string;
  readonly variable: EnvironmentVariableView | null;
  readonly existingKeys: readonly string[];
  readonly onSaved: () => void;
}) {
  const schema = variableFormSchema(variable, existingKeys);
  const save = useAction({
    action: (input: z.output<typeof environmentVariableInputSchema>) =>
      saveEnvironmentVariableFn({ data: { projectId, variable: input } }),
    successMessage: "Variável salva",
    invalidate: [["environment", projectId]],
    onSuccess: onSaved,
  });
  const form = useForm({
    defaultValues: draftFromVariable(variable),
    validators: { onChange: schema },
    onSubmit: ({ value }) => save.mutate(schema.parse(value)),
  });
  return { form, save };
}

export type VariableFormApi = ReturnType<typeof useVariableForm>["form"];
