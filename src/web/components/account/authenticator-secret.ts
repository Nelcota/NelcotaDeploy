const GROUP_SIZE = 4;

/**
 * Reads the secret of an authenticator URI, grouped for typing into an app by hand.
 *
 * @param totpUri - URI such as "otpauth://totp/Nelcota%20Deploy:ana@x.com?secret=JBSW...".
 * @returns The secret in groups of four characters, or null when the URI has none.
 */
export function authenticatorSecret(totpUri: string): string | null {
  if (URL.canParse(totpUri) === false) {
    return null;
  }
  const secret = new URL(totpUri).searchParams.get("secret")?.trim() ?? "";
  if (secret === "") {
    return null;
  }
  const groups: string[] = [];
  for (let start = 0; start < secret.length; start += GROUP_SIZE) {
    groups.push(secret.slice(start, start + GROUP_SIZE));
  }
  return groups.join(" ");
}
