import { z } from "zod";

import { environmentVariableInputSchema } from "./environment-variable.schema";

export const MAX_IMPORT_ENTRIES = 100;
export const MAX_IMPORT_TEXT_LENGTH = 262_144;

export const environmentImportSchema = z.object({
  kind: z.enum(["automatic", "plain", "secret"]),
  entries: z
    .array(
      z.object({
        key: environmentVariableInputSchema.shape.key,
        value: environmentVariableInputSchema.shape.value,
        kind: z.enum(["plain", "secret"]).optional(),
        expectedUpdatedAt: z.iso.datetime().nullable(),
      }),
    )
    .min(1, "Informe pelo menos uma variável")
    .max(MAX_IMPORT_ENTRIES, "Importe até 100 variáveis por vez")
    .refine(
      (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length,
      "Há nomes de variável repetidos",
    )
    .refine(
      (entries) =>
        entries.reduce((total, entry) => total + entry.key.length + entry.value.length, 0) <=
        MAX_IMPORT_TEXT_LENGTH,
      "Conteúdo muito longo",
    ),
});

export type EnvironmentImportInput = z.infer<typeof environmentImportSchema>;

/** Classifies credential names and URLs containing credentials without exposing their values. */
export function suggestedVariableKind(key: string, value: string): "plain" | "secret" {
  const credentialName =
    /(?:^|_)(?:SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE_KEY|API_KEY|ENCRYPTION_KEY|SIGNING_KEY|ACCESS_KEY|CREDENTIALS?|DATABASE_URL|REDIS_URL|CONNECTION_STRING)(?:_|$)/i;
  const credentialUrl = /^[a-z][a-z\d+.-]*:\/\/[^/\s]*:[^/\s]*@/i;
  return credentialName.test(key) || credentialUrl.test(value) ? "secret" : "plain";
}
