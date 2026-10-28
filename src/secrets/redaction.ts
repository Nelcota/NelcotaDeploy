const REDACTED = "[REDACTED]";
/** Short values would redact ordinary words, so they are not treated as secrets in logs. */
const MIN_REDACTABLE_LENGTH = 4;

/**
 * Builds a function that replaces known secret values in text.
 *
 * @param secrets - Plaintext secret values that must never appear in logs.
 * @returns A function that returns its input with every secret replaced by "[REDACTED]".
 */
export function createRedactor(secrets: readonly string[]): (text: string) => string {
  const redactable = [...new Set(secrets)]
    .filter((secret) => secret.length >= MIN_REDACTABLE_LENGTH)
    .toSorted((left, right) => right.length - left.length);
  if (redactable.length === 0) {
    return (text) => text;
  }
  return (text) => {
    let result = text;
    for (const secret of redactable) {
      result = result.replaceAll(secret, REDACTED);
    }
    return result;
  };
}
