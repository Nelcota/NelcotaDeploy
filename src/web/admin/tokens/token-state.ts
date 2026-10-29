const MILLISECONDS_PER_DAY = 86_400_000;
/** Tokens this close to their expiry are flagged so someone replaces them in time. */
const EXPIRY_WARNING_DAYS = 7;
const EXPIRY_WARNING_IN_MS = EXPIRY_WARNING_DAYS * MILLISECONDS_PER_DAY;

/** What a token can still do, as shown on its badge. */
type TokenState = {
  readonly tone: "success" | "warning" | "danger" | "neutral";
  readonly label: string;
};

/**
 * Tells whether a token still works and whether it needs attention soon.
 *
 * @param token - Revocation and expiry dates as UTC ISO strings, or null when absent.
 * @param now - Reference time.
 * @returns Badge tone and label in Portuguese.
 */
export function tokenState(
  token: { readonly revokedAt: string | null; readonly expiresAt: string | null },
  now: Date,
): TokenState {
  if (token.revokedAt != null) {
    return { tone: "neutral", label: "Revogado" };
  }
  if (token.expiresAt == null) {
    return { tone: "success", label: "Ativo" };
  }
  const expiresAt = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return { tone: "success", label: "Ativo" };
  }
  if (expiresAt <= now.getTime()) {
    return { tone: "danger", label: "Expirado" };
  }
  if (expiresAt - now.getTime() <= EXPIRY_WARNING_IN_MS) {
    return { tone: "warning", label: "Expira em breve" };
  }
  return { tone: "success", label: "Ativo" };
}

/**
 * Computes when a token created now would expire, to preview it while the days are typed.
 *
 * @param days - Validity typed by the user; blank means no expiry.
 * @param now - Reference time.
 * @param maxDays - Largest validity accepted.
 * @returns The expiry as a UTC ISO string, null for no expiry, or undefined when the text is
 * not a whole number of days between 1 and `maxDays`.
 */
export function expiryFor(days: string, now: Date, maxDays: number): string | null | undefined {
  const trimmed = days.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  if (Number.isInteger(value) === false || value < 1 || value > maxDays) {
    return undefined;
  }
  return new Date(now.getTime() + value * MILLISECONDS_PER_DAY).toISOString();
}
