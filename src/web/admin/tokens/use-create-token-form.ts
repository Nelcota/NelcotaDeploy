import { useForm } from "@tanstack/react-form";
import { z } from "zod";

import { useAction } from "@/web/components/layout/use-action";
import { createApiTokenFn } from "@/web/functions/settings.functions";

import type { TokenScope } from "./token-scopes";
import { expiryFor } from "./token-state";

// Same limit the server applies to token validity.
export const MAX_TOKEN_DAYS = 365;
const DEFAULT_TOKEN_DAYS = "90";
const MAX_TOKEN_NAME_LENGTH = 80;

const tokenFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe um nome")
    .max(MAX_TOKEN_NAME_LENGTH, `Use no máximo ${MAX_TOKEN_NAME_LENGTH} caracteres`),
  scopes: z.array(z.enum(["read", "deploy"])).min(1, "Escolha pelo menos um escopo"),
  expiresInDays: z
    .string()
    .refine(
      (days) => expiryFor(days, new Date(), MAX_TOKEN_DAYS) !== undefined,
      `Informe de 1 a ${MAX_TOKEN_DAYS} dias inteiros, ou deixe em branco`,
    ),
});

type TokenForm = z.input<typeof tokenFormSchema>;

const EMPTY_TOKEN: TokenForm = { name: "", scopes: ["read"], expiresInDays: DEFAULT_TOKEN_DAYS };

/** Form state of a new API token and the action that creates it. */
export function useCreateTokenForm(onCreated: (token: string) => void) {
  const create = useAction({
    action: (data: { name: string; scopes: TokenScope[]; expiresInDays: number | null }) =>
      createApiTokenFn({ data }),
    successMessage: "Token criado",
    invalidate: [["api-tokens"]],
    onSuccess: (result) => onCreated(result.token),
  });
  const form = useForm({
    defaultValues: EMPTY_TOKEN,
    validators: { onChange: tokenFormSchema },
    onSubmit: ({ value }) => {
      const parsed = tokenFormSchema.parse(value);
      const days = parsed.expiresInDays.trim();
      create.mutate({
        name: parsed.name,
        scopes: parsed.scopes,
        expiresInDays: days === "" ? null : Number(days),
      });
    },
  });
  return { form, isPending: create.isPending };
}

export type CreateTokenFormApi = ReturnType<typeof useCreateTokenForm>["form"];
