import { normalizeVariableKey, parseDotenv, type DotenvEntry } from "@/shared/dotenv";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";

const MAX_ASSIGNMENT_LENGTH = 33_000;

/** Recognizes exactly one pasted assignment without evaluating expansions or shell commands. */
export function parseVariableAssignment(text: string): DotenvEntry | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_ASSIGNMENT_LENGTH || /[\r\n\0]/.test(trimmed)) {
    return null;
  }
  const parsed = parseDotenv(trimmed);
  const entry = parsed.entries.at(0);
  if (parsed.problems.length > 0 || parsed.entries.length !== 1 || entry == null) {
    return null;
  }
  const key = environmentVariableInputSchema.shape.key.safeParse(normalizeVariableKey(entry.key));
  const value = environmentVariableInputSchema.shape.value.safeParse(entry.value);
  return key.success && value.success ? { key: key.data, value: value.data } : null;
}
