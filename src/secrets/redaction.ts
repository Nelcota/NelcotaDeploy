const REDACTED = "[REDACTED]";

function secretParts(secret: string): string[] {
  const password = URL.parse(secret)?.password;
  if (password == null || password === "") {
    return [secret];
  }
  try {
    return [secret, password, decodeURIComponent(password)];
  } catch {
    // A malformed percent escape is still a secret in its original encoded form.
    return [secret, password];
  }
}

/**
 * Builds a function that replaces known secret values in text.
 *
 * @param secrets - Plaintext secret values that must never appear in logs.
 * @returns A function that returns its input with every secret replaced by "[REDACTED]".
 */
export function createRedactor(secrets: readonly string[]): (text: string) => string {
  // Process runners deliver individual lines, including for multiline credentials.
  const redactable = [
    ...new Set(
      secrets.flatMap(secretParts).flatMap((secret) => {
        const plain = Bun.stripANSI(secret);
        return [plain].concat(plain.split(/\r\n|\n|\r/));
      }),
    ),
  ]
    .filter((secret) => secret.length > 0)
    .toSorted((left, right) => right.length - left.length);
  if (redactable.length === 0) {
    return (text) => Bun.stripANSI(text);
  }
  const pattern = new RegExp(redactable.map((secret) => RegExp.escape(secret)).join("|"), "g");
  return (text) => Bun.stripANSI(text).replaceAll(pattern, REDACTED);
}
