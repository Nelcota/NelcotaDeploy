const SECRET_BYTES = 32;
const GENERATABLE_SECRET = /^(?:BETTER_AUTH|AUTH|SESSION|JWT|APP|COOKIE|SIGNING)_SECRET$/;
const APPLICATION_URL_KEYS: ReadonlySet<string> = new Set([
  "APP_URL",
  "PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "VITE_APP_URL",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "BETTER_AUTH_URL",
  "AUTH_URL",
]);

/** Recognizes local signing secrets; external provider credentials must be supplied. */
export function isApplicationSecretKey(key: string): boolean {
  return GENERATABLE_SECRET.test(key);
}

/** Recognizes variables that refer to the application's own public address. */
export function isApplicationUrlKey(key: string): boolean {
  return APPLICATION_URL_KEYS.has(key);
}

/** Generates a 256-bit local signing secret without persisting it. */
export function generateApplicationSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
