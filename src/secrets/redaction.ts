const REDACTED = "[REDACTED]";

/**
 * Builds a function that replaces known secret values in text.
 *
 * @param secrets - Plaintext secret values that must never appear in logs.
 * @returns A function that returns its input with every secret replaced by "[REDACTED]".
 */
export function createRedactor(secrets: readonly string[]): (text: string) => string {
  // Process runners deliver individual lines, including for multiline credentials.
  const redactable = [
    ...new Set(secrets.flatMap((secret) => [secret, ...secret.split(/\r\n|\n|\r/)])),
  ]
    .filter((secret) => secret.length > 0)
    .toSorted((left, right) => right.length - left.length);
  if (redactable.length === 0) {
    return (text) => text;
  }
  const pattern = new RegExp(redactable.map((secret) => RegExp.escape(secret)).join("|"), "g");
  return (text) => text.replaceAll(pattern, REDACTED);
}
