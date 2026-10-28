import { z } from "zod";

const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 32_768;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Names the platform sets itself or that would change how the container runs. */
const RESERVED_KEY_PREFIXES = ["NELCOTA_", "DOCKER_"];

/**
 * Tells whether an environment variable name is valid and not reserved.
 *
 * @param key - Variable name.
 * @returns True for POSIX-style names outside the reserved prefixes.
 */
function isValidEnvironmentVariableKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || KEY_PATTERN.test(key) === false) {
    return false;
  }
  const upperKey = key.toUpperCase();
  return RESERVED_KEY_PREFIXES.some((prefix) => upperKey.startsWith(prefix)) === false;
}

export const environmentVariableInputSchema = z.object({
  key: z.string().trim().refine(isValidEnvironmentVariableKey, {
    message: "Use letras, números e _ (sem começar com número, NELCOTA_ ou DOCKER_)",
  }),
  kind: z.enum(["plain", "secret"]),
  value: z
    .string()
    .max(MAX_VALUE_LENGTH, "Valor muito longo")
    .refine((value) => value.includes("\0") === false, { message: "Valor inválido" }),
  availableAtBuild: z.boolean(),
});

export type EnvironmentVariableInput = z.infer<typeof environmentVariableInputSchema>;
