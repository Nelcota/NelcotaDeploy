import { useForm } from "@tanstack/react-form";
import type { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";
import { useAction } from "@/web/components/layout/use-action";
import { saveEnvironmentVariableFn } from "@/web/functions/environment.functions";

import { draftFromVariable } from "./variable-draft";

/**
 * Form state and save action of the variable dialog.
 *
 * @param options - Project, variable being edited (null for a new one) and what to do after saving.
 * @returns The form and the save action, whose `isPending` drives the submit button.
 */
export function useVariableForm({
  projectId,
  variable,
  onSaved,
}: {
  readonly projectId: string;
  readonly variable: EnvironmentVariableView | null;
  readonly onSaved: () => void;
}) {
  const savedSecret = variable?.kind === "secret";
  // A saved secret keeps its value when left blank; a new one needs a value.
  const schema = environmentVariableInputSchema.refine(
    (input) => input.kind !== "secret" || input.value !== "" || savedSecret,
    { path: ["value"], message: "Informe o valor do secret" },
  );
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
