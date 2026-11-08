import type { EnvironmentVariableView } from "@/environments";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";

/** Prevents a new draft from replacing an existing variable or clearing a secret accidentally. */
export function variableFormSchema(
  variable: EnvironmentVariableView | null,
  existingKeys: readonly string[],
) {
  return environmentVariableInputSchema
    .refine(
      (input) => input.kind !== "secret" || input.value !== "" || variable?.kind === "secret",
      { path: ["value"], message: "Informe o valor do secret" },
    )
    .refine((input) => variable != null || existingKeys.includes(input.key) === false, {
      path: ["key"],
      message: "Esta variável já existe. Use Editar para alterar seu valor.",
    });
}
